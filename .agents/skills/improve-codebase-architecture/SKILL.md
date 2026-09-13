---
name: improve-codebase-architecture
description: Find evidence-backed module refactors and explain their tradeoffs in an architecture review.
disable-model-invocation: true
---

# Improve codebase architecture

Find refactors that hide meaningful complexity behind a smaller interface and make likely changes easier. Focus on the subsystem the user named; otherwise use recent changes and caller relationships to identify useful areas to inspect.

Use relevant domain terms and ADRs when present. Trace callers and tests to explain where a boundary leaks knowledge or spreads one change across files. Distinguish observed friction from speculative improvements.

For each worthwhile candidate, identify the files, current problem, proposed boundary, tradeoffs, and how behavior would be verified. Recommend the strongest candidate with evidence. Do not force a candidate count or invent missing project documents.

For an HTML review, use [HTML-REPORT.md](HTML-REPORT.md) as an optional scaffold. Write a uniquely named report in the OS temporary directory and provide its absolute path. Use diagrams where they clarify relationships; follow a requested output format.

A review is complete when the findings and recommendation are delivered. If the user requested implementation or already chose a candidate, continue through the scoped refactor and relevant validation. Ask for a choice only when competing directions require one. Update domain documents or ADRs when the requested work warrants them.
