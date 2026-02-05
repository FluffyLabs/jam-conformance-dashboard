import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const REPO_URL = "https://github.com/w3f/jam-conformance";
const WORK_DIR = join(process.cwd(), "repo");
const REPORT_REL_PATH = "fuzz-reports/0.7.2/summaries";
const OUTPUT_FILE = join(process.cwd(), "merged_summary.md");
const README_FILE = join(process.cwd(), "README.md");

type Status = "🔴" | "🟢";
// TraceID -> (Team -> Status)
const results = new Map<string, Map<string, Status>>();
const allTeams = new Set<string>();

async function main() {
  console.log(`Working directory: ${WORK_DIR}`);

  if (!existsSync(WORK_DIR)) {
    console.log("Cloning repository...");
    await $`git clone ${REPO_URL} ${WORK_DIR}`;
  } else {
    console.log("Repository exists, fetching updates...");
    $.cwd(WORK_DIR);
    await $`git fetch --all`;
    // We don't necessarily need to be on main, just need the objects
  }

  // Set working directory for shell commands
  $.cwd(WORK_DIR);

  console.log("Listing remote branches...");
  const branchesOutput = await $`git branch -r`.text();
  const branches = branchesOutput
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b && !b.includes("->") && b.startsWith("origin/"))
    .map((b) => b.replace("origin/", ""));

  console.log(`Found ${branches.length} branches.`);

  let mergedContent = "";

  for (const branch of branches) {
    console.log(`Processing branch: ${branch}`);
    try {
      await $`git checkout -f ${branch}`;

      const summariesDir = join(WORK_DIR, REPORT_REL_PATH);
      if (existsSync(summariesDir)) {
        const files = readdirSync(summariesDir).filter(
          (f) => f.startsWith("summary_") && f.endsWith(".txt"),
        );

        if (files.length > 0) {
          mergedContent += `\n\n================================================================================\n`;
          mergedContent += `BRANCH: ${branch}\n`;
          mergedContent += `================================================================================\n`;

          for (const file of files) {
            const teamName = file.replace("summary_", "").replace(".txt", "");
            allTeams.add(teamName);

            // console.log(`    Reading ${file}`);
            const content = readFileSync(join(summariesDir, file), "utf-8");
            mergedContent += `\n--- FILE: ${file} ---\n`;
            mergedContent += content;

            // Parse content for table
            const lines = content.split("\n");
            for (const line of lines) {
              // Match red or green circle
              const match = line.match(/([\u{1F534}\u{1F7E2}])\s+(\d+)/u);
              if (match) {
                const [_, status, traceId] = match;

                if (!results.has(traceId)) {
                  results.set(traceId, new Map());
                }
                // Last write wins (from latest branch processed)
                results.get(traceId)?.set(teamName, status as Status);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`  Failed to process branch ${branch}:`, e);
    }
  }

  console.log(`Writing merged summary to ${OUTPUT_FILE}`);
  writeFileSync(OUTPUT_FILE, mergedContent);

  console.log("Generating Markdown table...");
  const allTraces = Array.from(results.keys()).sort();
  const sortedTeams = Array.from(allTeams).sort();

  // 1. Identify "Interesting" traces (at least one failure)
  const interestingTraces: string[] = [];
  const boringTraces: string[] = [];

  for (const trace of allTraces) {
    let hasFailure = false;
    const teamStatusMap = results.get(trace);

    if (teamStatusMap) {
      for (const team of sortedTeams) {
        if (teamStatusMap.get(team) === "🔴") {
          hasFailure = true;
          break;
        }
      }
    }

    if (hasFailure) {
      interestingTraces.push(trace);
    } else {
      boringTraces.push(trace);
    }
  }

  console.log(`Traces with failures: ${interestingTraces.length}`);
  console.log(`Traces without failures: ${boringTraces.length}`);

  let mdTable = `| Team | 🔴 | 🟢 | ⚪ | ${interestingTraces.join(" | ")} |\n`;
  mdTable += `|---|---|---|---|${interestingTraces.map(() => "---").join("|")}|\n`;

  for (const team of sortedTeams) {
    let row = `| ${team} |`;

    // Calculate summary stats across ALL traces
    let redCount = 0;
    let greenCount = 0;
    let unknownCount = 0;

    for (const trace of allTraces) {
      const status = results.get(trace)?.get(team);
      if (status === "🔴") {
        redCount++;
      } else if (status === "🟢") {
        greenCount++;
      } else {
        unknownCount++;
      }
    }

    row += ` ${redCount} | ${greenCount} | ${unknownCount} |`;

    // Columns for interesting traces
    for (const trace of interestingTraces) {
      const status = results.get(trace)?.get(team) || "⚪";
      row += ` ${status} |`;
    }

    mdTable += `${row}\n`;
  }

  console.log("Table generation complete.");

  // Read README.md
  if (existsSync(README_FILE)) {
    const readmeContent = readFileSync(README_FILE, "utf-8");
    const startMarker = "<!-- CONFORMANCE_TABLE_START -->";
    const endMarker = "<!-- CONFORMANCE_TABLE_END -->";

    const startIndex = readmeContent.indexOf(startMarker);
    const endIndex = readmeContent.indexOf(endMarker);

    if (startIndex !== -1 && endIndex !== -1) {
      console.log(`Updating ${README_FILE}...`);
      const before = readmeContent.substring(
        0,
        startIndex + startMarker.length,
      );
      const after = readmeContent.substring(endIndex);

      const newContent = `${before}\n\n${mdTable}\n${after}`;
      writeFileSync(README_FILE, newContent);
      console.log("README.md updated.");
    } else {
      console.error(`Markers not found in ${README_FILE}. Table not updated.`);
    }
  } else {
    console.error(`${README_FILE} not found.`);
  }

  console.log("Done!");
}

main().catch(console.error);
