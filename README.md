# PebbleGym 🏋️‍♂️

**Hevy Workout Routine Companion & History Tracker for Pebble Smartwatches**

> [!NOTE]
> **This is a Vibe-Coding project! 🎸✨**
> Built interactively using advanced agentic AI pair-programming to design, prototype, and build features on-the-fly.

PebbleGym brings your fitness routines directly to your wrist. Compatible with all major Pebble SDK 3.0 platforms (optimized for Pebble Time 2 `emery`, `basalt`, and `chalk`), it allows you to sync your training plans from the **Hevy** app, track sets, adjust weights, and view your historical progress on the fly.

---

## 🌟 Key Features

*   🔗 **Hevy Routine Import**: Paste your public Hevy routine link (`https://hevy.com/routine/[id]`) in the configuration page. The PebbleKit JS companion automatically fetches and scrapes the routine structure (no Hevy Pro API key required, though supported!).
*   📊 **Workout UI with Set Indicators**: Displays active exercise name, current set (e.g. `Set 2/4`), and targets (`10 x 80 kg`). Underneath, it highlights previous workout stats (`Last time: 10 x 75 kg`) for rapid progress tracking.
*   🟢 **Set Progress Ring/Dots**: Features custom-drawn progress dots showing completed sets (green), active sets (yellow ring), and upcoming sets (gray outline) directly on the screen.
*   🔒 **Accidental Click Protection**: Completing/logging a set requires a **long-press** on the *Select* button, preventing sweaty hands or accidental bumps from falsely marking sets as done.
*   🔀 **Exercise Jumping Menu**: Single-click on the *Select* button opens a quick scrollable list of all exercises. Jump around to any exercise if gym machines are busy, and skip/resume seamlessly.
*   ✏️ **Inline Weight & Reps Editor**: Long press the *Up* or *Down* buttons to dynamically tweak weight (+/- 2.5 kg/lbs) or reps (+/- 1) directly on the watch screen for the current set.
*   ⏱️ **Rest Timer & Haptics**: Triggers a customizable rest timer (60s, 90s, 120s, etc.) with a sleek progress bar. The watch double-pulses haptically when rest is finished.
*   💾 **Unlimited History & CSV Export**: The phone companion caches all completed workouts in `localStorage`, bypassing the watch's 4KB persistent storage limit. Export history into standard `.csv` spreadsheet files anytime.

---

## 🎮 On-Watch Button Map

| Button | Press Type | Action in Workout Screen | Action in Edit Mode |
| :--- | :--- | :--- | :--- |
| **SELECT (Middle)** | **Single Press** | Opens **Exercise Menu** (Jump or Finish) | Saves edits & returns |
| **SELECT (Middle)** | **Long Press** | **Logs active set as completed** | *None* |
| **UP (Top)** | **Single Press** | Scrolls up to previous set | Increments (+1 Rep / +2.5 weight) |
| **UP (Top)** | **Long Press** | Opens **Weight Editor** for current set | *None* |
| **DOWN (Bottom)** | **Single Press** | Scrolls down to next set | Decrements (-1 Rep / -2.5 weight) |
| **DOWN (Bottom)** | **Long Press** | Opens **Reps Editor** for current set | *None* |
| **BACK (Left)** | **Single Press** | Returns to sync screen / Dismisses rest timer | Cancels edits (discards changes) |

---

## 🛠️ Technical Architecture

PebbleGym utilizes a split watchapp/phone-companion architecture:

```mermaid
graph TD
    subgraph Watch (C)
        main.c[main.c: UI / Workout State / Timer / Editor]
    end
    subgraph Phone (PebbleKit JS)
        index.js[index.js: AppMessage Sync / Hevy HTML Scraper]
        config.html[config.html: Dark Mode Settings Page & CSV Exporter]
    end
    
    config.html -- "Input Hevy Link / Change Settings" --> index.js
    index.js -- "Sync Exercises & Sets (AppMessage)" --> main.c
    main.c -- "Log Completed Sets (AppMessage)" --> index.js
    index.js -- "Append to localStorage History" --> index.js
```

---

## 🚀 Building & Compiling

The watchapp compiles into a single Pebble bundle (`build/project.pbw`) using the Pebble SDK. Due to Python 2.7 dependencies in the legacy Pebble SDK, compiling inside a Docker container is recommended.

1.  Make sure Docker is installed and running.
2.  Open your terminal inside the `pebble-gym-hevy` directory.
3.  Run the build helper script:
    ```powershell
    ./docker_build.sh
    ```
    *Alternatively, run the Docker command directly:*
    ```powershell
    docker run --rm -v "${PWD}:/app" rebble/pebble-sdk bash /app/docker_build.sh
    ```
4.  The compiled watchapp binary will be saved to: `build/project.pbw`.
