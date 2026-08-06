# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
