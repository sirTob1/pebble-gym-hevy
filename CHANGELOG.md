# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.8.0] - 2026-08-14

### Fixed
- **Workout Persistence Resume:** Fixed a critical race condition bug where an interrupted workout session could not be resumed due to an empty routine ID being persisted. The watch will now correctly auto-resume or allow manual resume of the crashed session. (Closes #46)

## [3.7.0] - 2026-08-12

### Added
- **Resume Workout:** Added a dedicated "Resume Workout" option to the Routine Menu for interrupted sessions. (Closes #45)
- **Overwrite Protection:** Added a confirmation dialog if a user tries to start a new routine while a workout is already in progress, preventing accidental data loss.

## [3.6.0] - 2026-08-07

### Added
- **Custom Rest Timer:** Added the ability to specify a custom rest timer (in seconds) directly from the Settings page instead of being limited to predefined options. (Closes #35)

### Removed
- **App Logging:** Removed developer-centric logging features and UI from the app to streamline the codebase and settings page. (Closes #43)

### Fixed
- **Workout Persistence Crash:** Fixed a memory limit bug in the persistent storage structs that caused workout session progress to silently fail to save and subsequently be lost if the app crashed. (Closes #37)

## [3.5.0] - 2026-08-06

### Added
- **App Logging:** Implemented an efficient logging mechanism accessible via the Settings Page to assist with debugging app crashes.
- **Workout Confirmation:** Added a confirmation dialog when finishing or discarding a workout from the quick exercise menu to prevent accidental closures.

### Fixed
- **Workout Persistence:** Fixed a bug where starting a workout on the watch would not correctly track the active routine ID, causing the app to load the wrong routine or fail to recover if the app crashed during a workout.

## [3.4.0] - 2026-07-24

### Added
- **Workout Persistence:** The active workout state is now continuously saved. If the Pebble app or phone companion app crashes, closes, or restarts, your workout will automatically resume exactly where you left off without losing any logged sets.

### Fixed
- **Stability Fixes:** Resolved critical bugs that caused intermittent watch app crashes (Use-After-Free memory leaks and window stack corruption) during menu navigation and background syncs.

## [3.3.0] - 2026-06-25

### Added
- **Hold-to-Repeat Edit Mode:** You can now hold down the Up or Down buttons while editing weight or reps to continuously and quickly increase or decrease the values.

### Changed
- **Workout UI:** Increased font size of top status bar (time and current set) and previous performance stats for better legibility. Adjusted layout to prevent overlap with set indicator dots.

## [3.2.0] - 2026-06-17

### Added
- **Custom Workout Routines:** You can now create new custom workout routines directly from the watch's Settings page on your phone without relying on Hevy imports.
- **Add Exercises:** Added an "+ Exercise" button inside the Routine Editor to populate your custom routines.
- **Button Hints:** Helpful on-screen hints to quickly reference button mappings during your workout (can be toggled off in settings).

### Changed
- The Routine Editor now cleanly handles newly created empty routines and prevents saving blank templates.
