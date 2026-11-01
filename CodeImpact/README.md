# CodeImpact — Change Impact Analyzer

A browser-based prototype built with HTML, CSS, JavaScript, Bootstrap, JSZip, and Cytoscape.js.

## Run it
1. Extract the project ZIP.
2. Open the `CodeImpact` folder in VS Code.
3. Open `index.html` in a browser, or run it with the VS Code Live Server extension.
4. Click **Try sample** to load a demo project.
5. Select a target file, edit the proposed code in the **After** editor, and click **Analyze change impact**.
6. Export a report as a `.txt` file if needed.

## Features
- Upload `.js`, `.mjs`, `.cjs` files or a ZIP containing JavaScript source files.
- Basic local import/require dependency detection.
- Dependency graph visualization.
- Direct and indirect dependent-file listing.
- Approximate text change summary.
- Heuristic risk score and downloadable text report.
- Browser-local analysis history using `localStorage`.
- Responsive dark dashboard UI.

## Limitations
This is a learning/demo prototype, not a full static-analysis engine. Import detection is regex-based and may miss aliases, TypeScript, package/bundler resolution, dynamic imports, comments/strings that resemble imports, and more complex syntax. The risk score is illustrative. Always use tests, linting, code review, and a proper parser before relying on change-impact conclusions.

## External libraries
Bootstrap, Bootstrap Icons, JSZip, and Cytoscape.js are loaded from CDNs, so an internet connection is needed for their full styling/ZIP/graph features.
