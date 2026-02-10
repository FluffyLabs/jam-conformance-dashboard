import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const REPO_URL = "https://github.com/w3f/jam-conformance";
const WORK_DIR = join(process.cwd(), "repo");
const REPORT_REL_PATH = "fuzz-reports/0.7.2/summaries";
const TRACES_REL_PATH = "fuzz-reports/0.7.2/traces";
const OUTPUT_FILE = join(process.cwd(), "merged_summary.md");
const README_FILE = join(process.cwd(), "README.md");

type Status = "🔴" | "🟢";
// TraceID -> (Team -> Status)
const results = new Map<string, Map<string, Status>>();
// TraceID -> BranchName (where the trace directory was found)
const traceBranchMap = new Map<string, string>();
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

  const toc: string[] = [];
  let bodyContent = "";

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
          toc.push(
            `- [${branch}](#branch-${branch.toLowerCase().replace(/[^a-z0-9]/g, "-")})`,
          );
          bodyContent += `\n## Branch: ${branch}\n`;

          for (const file of files) {
            const teamName = file.replace("summary_", "").replace(".txt", "");
            allTeams.add(teamName);

            toc.push(
              `  - [${teamName}](#${teamName.toLowerCase().replace(/[^a-z0-9]/g, "-")})`,
            );
            bodyContent += `\n### ${teamName}\n\n`;

            // Add Generic Link to Traces for this branch
            bodyContent += `[📂 View Traces for this Branch](${REPO_URL}/tree/${branch}/${TRACES_REL_PATH})\n\n`;

            // console.log(`    Reading ${file}`);
            const content = readFileSync(join(summariesDir, file), "utf-8");

            // Parse content for table
            const lines = content.split("\n");
            const validLines: string[] = [];

            for (const line of lines) {
              // Match red or green circle
              const match = line.match(/([\u{1F534}\u{1F7E2}])\s+([0-9_]+)/u);
              if (match) {
                const [_full, status, traceId] = match;
                validLines.push(`${status} ${traceId}`); // Just text, no links

                if (!results.has(traceId)) {
                  results.set(traceId, new Map());
                }
                // Last write wins (from latest branch processed)
                results.get(traceId)?.set(teamName, status as Status);

                // Check if trace directory exists on this branch to link it (for the table)
                if (!traceBranchMap.has(traceId)) {
                  const traceDir = join(WORK_DIR, TRACES_REL_PATH, traceId);
                  if (existsSync(traceDir)) {
                    traceBranchMap.set(traceId, branch);
                  }
                }
              }
            }

            if (validLines.length > 0) {
              bodyContent += `${validLines.map((l) => `- ${l}`).join("\n")}\n`;
            } else {
              bodyContent += "_No results found in this summary file._\n";
            }
          }
        }
      }
    } catch (e) {
      console.error(`  Failed to process branch ${branch}:`, e);
    }
  }

  // Construct Final Merged Content
  let mergedContent =
    "# Merged Summary\n\nGenerated from `jam-conformance` repository.\n\n## Table of Contents\n\n";
  mergedContent += `${toc.join("\n")}\n`;
  mergedContent += bodyContent;

  // No footer links needed anymore since we removed per-trace links

  console.log(`Writing merged summary to ${OUTPUT_FILE}`);
  writeFileSync(OUTPUT_FILE, mergedContent);

  console.log("Generating Markdown table...");
  const allTraces = Array.from(results.keys()).sort();
  const sortedTeams = Array.from(allTeams).sort((a, b) => {
    if (a === "typeberry") return -1;
    if (b === "typeberry") return 1;
    return a.localeCompare(b);
  });

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

  const linkify = (traceId: string) => {
    const branch = traceBranchMap.get(traceId);
    if (branch) {
      return `[${traceId}](${REPO_URL}/tree/${branch}/${TRACES_REL_PATH}/${traceId})`;
    }
    return traceId;
  };

  // Transposed Table Generation
  // Header: Trace | Team1 | Team2 | ...
  let mdTable = `| Trace | ${sortedTeams.join(" | ")} |\n`;
  mdTable += `|---|${sortedTeams.map(() => "---").join("|")}|\n`;

  // Pre-calculate stats per team
  const teamStats = new Map<
    string,
    { red: number; green: number; unknown: number }
  >();
  for (const team of sortedTeams) {
    let red = 0;
    let green = 0;
    let unknown = 0;
    for (const trace of allTraces) {
      const status = results.get(trace)?.get(team);
      if (status === "🔴") red++;
      else if (status === "🟢") green++;
      else unknown++;
    }
    teamStats.set(team, { red, green, unknown });
  }

  // Summary Rows
  let redRow = `| 🔴 |`;
  let greenRow = `| 🟢 |`;
  let unknownRow = `| ⚪ |`;

  for (const team of sortedTeams) {
    const stats = teamStats.get(team)!;
    redRow += ` ${stats.red} |`;
    greenRow += ` ${stats.green} |`;
    unknownRow += ` ${stats.unknown} |`;
  }

  mdTable += `${redRow}\n${greenRow}\n${unknownRow}\n`;

  // Data Rows (Traces)
  for (const trace of interestingTraces) {
    let row = `| ${linkify(trace)} |`;
    for (const team of sortedTeams) {
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
