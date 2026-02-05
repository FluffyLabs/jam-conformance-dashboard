# JAM Conformance Summary Aggregator

This project aggregates summary files from all branches of the `jam-conformance` repository.

## Conformance Table

<!-- CONFORMANCE_TABLE_START -->
<!-- CONFORMANCE_TABLE_END -->

## Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- Git

## Usage

1.  Clone this repository.
2.  Run the aggregation script:

```bash
./run.sh
```

This will:
1.  Clone `https://github.com/w3f/jam-conformance` into `./repo` (or update if exists).
2.  Iterate through all remote branches.
3.  Look for files in `fuzz-reports/0.7.2/summaries/`.
4.  Aggregate contents into `merged_summary.txt`.
5.  Update the table in `README.md`.

## Output

- `merged_summary.txt`: Concatenated content of all summary files found in all branches.
- `README.md`: Updated with the Conformance Table.
