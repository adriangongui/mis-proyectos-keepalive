#!/usr/bin/env node

/**
 * Supabase Keep-Alive Pinger
 *
 * Pings all configured Supabase projects by doing real database operations
 * (insert + delete on a keep_alive table) to prevent free-tier pausing.
 *
 * Setup:
 *   1. Create a `keep_alive` table in each project (see README)
 *   2. Set SUPABASE_PROJECTS env var as a JSON array:
 *      [{"name":"my-app","url":"https://xxx.supabase.co","key":"sb_publishable_..."},...]
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

async function pingProject({ name, url, key }) {
  const start = Date.now();
  try {
    const supabase = createClient(url, key, {
      realtime: { transport: ws },
      auth: { persistSession: false },
    });

    // Insert a row
    const { error: insertError } = await supabase
      .from("keep_alive")
      .insert({ pinged_at: new Date().toISOString() });

    if (insertError) {
      const ms = Date.now() - start;
      console.error(
        `  ✗ ${name} — insert failed (${ms}ms): ${insertError.message}`,
      );
      return { name, ok: false, ms, error: insertError.message };
    }

    // Clean up: keep only last 5 rows to avoid table bloat
    const { data: rows } = await supabase
      .from("keep_alive")
      .select("id")
      .order("id", { ascending: true });

    if (rows && rows.length > 5) {
      const toDelete = rows.slice(0, rows.length - 5).map((r) => r.id);
      await supabase.from("keep_alive").delete().in("id", toDelete);
    }

    const ms = Date.now() - start;
    console.log(`  ✓ ${name} — pinged (${ms}ms)`);
    return { name, ok: true, ms };
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`  ✗ ${name} — ${err.message} (${ms}ms)`);
    return { name, ok: false, ms, error: err.message };
  }
}

async function main() {
  const raw = process.env.SUPABASE_PROJECTS;
  if (!raw) {
    console.error(
      "ERROR: SUPABASE_PROJECTS env var not set.\n" +
        "Set it to a JSON array, e.g.:\n" +
        '  [{"name":"my-app","url":"https://xxx.supabase.co","key":"sb_publishable_..."}]',
    );
    process.exit(1);
  }

  let projects;
  try {
    projects = JSON.parse(raw);
  } catch {
    console.error("ERROR: SUPABASE_PROJECTS is not valid JSON.");
    process.exit(1);
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    console.error("ERROR: SUPABASE_PROJECTS must be a non-empty JSON array.");
    process.exit(1);
  }

  console.log(
    `\n🏓 Supabase Keep-Alive — ${new Date().toISOString()}\n` +
      `   Pinging ${projects.length} project(s)...\n`,
  );

  const results = await Promise.all(projects.map(pingProject));

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n   Done: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
