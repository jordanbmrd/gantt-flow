# GanttFlow

A lightweight, zero-dependency Gantt chart builder that runs entirely in the browser.

![GanttFlow](https://img.shields.io/badge/built%20with-HTML%20%2F%20CSS%20%2F%20JS-4F8EF7?style=flat-square)
![No dependencies](https://img.shields.io/badge/dependencies-none-6BC47A?style=flat-square)

## Features

- **Add & manage tasks** – give each task a name, start month/year, duration (in months), and a colour.
- **Interactive Gantt chart** – SVG-based chart that auto-scales to cover all tasks.
- **Drag to resize** – drag the right edge of any bar to adjust its end date on the fly.
- **Edit & delete** – inline editing from the sidebar; delete with a single click.
- **Today marker** – toggleable vertical line that shows the current date on the chart.
- **Checkpoints** – place named vertical milestones anywhere on the timeline; drag them to reposition or right-click to rename / delete.
- **Export PNG** – download a pixel-perfect snapshot of the chart.
- **Copy to clipboard** – copy the chart image directly to the clipboard.
- **Persistent storage** – tasks and checkpoints are saved in `localStorage` so your work survives page refreshes.

## Getting Started

No build step required. Just open `index.html` in any modern browser:

```bash
git clone https://github.com/jordanbmrd/gantt-flow.git
cd gantt-flow
open index.html   # macOS
# or
xdg-open index.html   # Linux
# or double-click index.html in your file explorer
```

> You can also serve the files with any static HTTP server if you prefer:
> ```bash
> npx serve .
> ```

## Usage

1. **Add a task** – fill in the form at the bottom of the page (task name, start month & year, duration in months, colour) then click **Add Task**.
2. **Edit a task** – hover over a task in the sidebar and click the pencil icon; the form will pre-fill with the existing values.
3. **Resize a bar** – drag the right handle of any bar in the chart to change the task's end date.
4. **Add a checkpoint** – click **Checkpoint** in the header, enter a label, click **Place on chart**, then click anywhere on the timeline.
5. **Move a checkpoint** – drag the checkpoint line left or right.
6. **Delete a checkpoint** – right-click the checkpoint line and choose **Delete**.
7. **Toggle today** – click the **Today** button in the header to show or hide the current-date marker.
8. **Export** – click **Export PNG** to download the chart, or **Copy** to copy it to the clipboard.

## Project Structure

```
gantt-flow/
├── index.html   # App shell & markup
├── style.css    # All styles (layout, components, animations)
└── app.js       # Application logic (state, rendering, interactions)
```

## Browser Support

Works in all modern browsers that support SVG, `localStorage`, and the Canvas/Clipboard APIs (Chrome, Firefox, Safari, Edge).

## License

MIT
