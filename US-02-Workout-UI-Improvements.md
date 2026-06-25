# US-02: Workout Screen UI Readability Improvements

## Description
**As a** gym goer  
**I want to** have larger fonts for the current set info and previous performance, and better spacing for the set indicators  
**So that** I can easily read my workout data at a quick glance without text overlapping.

## Acceptance Criteria

### Functional Requirements
- [ ] The font size of the time and current set information (e.g., "16:47" and "Satz 1/3") below the main header must be increased.
- [ ] The font size of the previous performance text (e.g., "Letztes Mal: 15 x 20 kg") must be increased for better legibility.
- [ ] The vertical position (Y-coordinate) of the set indicator dots must be moved further down.
- [ ] The set indicator dots must no longer visually overlap with the previous performance text.

### Non-Functional Requirements
- [ ] **Usability:** The new font sizes and layout adjustments must still fit well within the standard Pebble screen bounds (e.g., Pebble Time / Basalt) without clipping or pushing other essential UI elements off-screen.
