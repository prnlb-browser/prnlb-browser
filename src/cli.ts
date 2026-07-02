import * as fs from "node:fs";
import * as path from "node:path";
import { crawl } from "./scraper.js";
import { createTopicStore } from "./db.js";
import type { Config, CrawlProgress } from "./types.js";

function loadConfig(configPath: string): Config {
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as Config;
}

function printProgress(p: CrawlProgress): void {
  switch (p.phase) {
    case "login":
      console.log(`🔐 ${p.message}`);
      break;
    case "listing":
      console.log(`📄 ${p.message}`);
      break;
    case "detail": {
      const pct = p.total ? `[${p.current}/${p.total}]` : "";
      const name = p.message.length > 60 ? p.message.substring(0, 60) + "..." : p.message;
      console.log(`  🔍 ${pct} ${name}`);
      break;
    }
    case "done":
      console.log(`\n✅ ${p.message}`);
      break;
    case "error":
      console.error(`❌ ${p.message}`);
      break;
  }
}

async function main() {
  const configPath = path.resolve(process.cwd(), "config.json");
  const config = loadConfig(configPath);

  // Open DB
  const db = createTopicStore(config.dbPath);
  const existingCount = db.count();
  console.log(`📂 Database: ${existingCount} existing topics`);

  // Build set of existing URLs for skip logic
  const existingUrls = new Set(db.getAll().map((t) => t.topicUrl));

  const { results, skipped: preFiltered } = await crawl(config, printProgress, existingUrls);

  // Insert into DB (skip existing)
  const { inserted, skipped: dbSkipped } = db.insertMany(results);
  const totalSkipped = preFiltered + dbSkipped;
  console.log(`💾 DB: ${inserted} new topics inserted, ${totalSkipped} already existed`);

  // Also save to JSON file
  const outputPath = path.resolve(process.cwd(), config.outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`💾 JSON saved to ${outputPath} (${results.length} topics)`);

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
