#include <pebble.h>

#define MAX_EXERCISES 15
#define MAX_SETS_PER_EX 8

// Weight unit types
#define UNIT_KG 0
#define UNIT_LBS 1

// Language configurations
typedef enum {
  LANG_DE = 0,
  LANG_EN = 1
} AppLanguage;

#define PERSIST_KEY_LANGUAGE 100
static AppLanguage s_language = LANG_DE;

static const char* translate(const char* de, const char* en) {
  return (s_language == LANG_EN) ? en : de;
}

// Edit modes
typedef enum {
  EDIT_NONE = 0,
  EDIT_WEIGHT,
  EDIT_REPS
} EditMode;

// Set data structure
typedef struct {
  int index;
  int reps;
  int weight; // weight * 100 (integer)
  int prev_reps;
  int prev_weight; // weight * 100 (integer)
  int logged_reps;
  int logged_weight; // weight * 100 (integer)
  bool completed;
  bool skipped;
} SetData;

// Exercise data structure
typedef struct {
  int index;
  char name[32];
  int set_count;
  SetData sets[MAX_SETS_PER_EX];
} ExerciseData;

// Global State
#define MAX_ROUTINES 10

typedef struct {
  char id[16];
  char name[32];
} RoutineHeader;

static RoutineHeader s_routines[MAX_ROUTINES];
static int s_routine_count = 0;
static char s_active_routine_id[16] = "";

static ExerciseData s_exercises[MAX_EXERCISES];
static int s_exercise_count = 0;
static int s_expected_exercise_count = 0;
static int s_current_exercise_idx = 0;
static int s_current_set_idx = 0;

static bool s_workout_in_progress = false;
static int s_weight_unit = UNIT_KG;
static int s_rest_seconds = 90;
static int s_rest_seconds_left = 0;
static AppTimer *s_rest_timer = NULL;

// Inline editor state
static EditMode s_edit_mode = EDIT_NONE;
static int s_edit_weight = 0;
static int s_edit_reps = 0;

// UI Windows & Layers
static Window *s_sync_window;
static Layer *s_sync_layer;

static Window *s_workout_window;
static Layer *s_workout_layer;

static Window *s_exercise_menu_window;
static MenuLayer *s_exercise_menu_layer;

static Window *s_routine_menu_window = NULL;
static MenuLayer *s_routine_menu_layer = NULL;

// Fonts
static GFont s_title_font;
static GFont s_main_font;
static GFont s_label_font;

// Prototypes
static void sync_window_load(Window *window);
static void sync_window_unload(Window *window);
static void workout_window_load(Window *window);
static void workout_window_unload(Window *window);
static void exercise_menu_window_load(Window *window);
static void exercise_menu_window_unload(Window *window);
static void routine_menu_window_load(Window *window);
static void routine_menu_window_unload(Window *window);
static void timer_callback(void *data);

// Send set logging data back to phone JS
static void send_logged_set(int ex_idx, int set_idx, int reps, int weight, bool completed) {
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  if (iter) {
    dict_write_uint8(iter, MESSAGE_KEY_LOG_EXERCISE_INDEX, ex_idx);
    dict_write_uint8(iter, MESSAGE_KEY_LOG_SET_INDEX, set_idx);
    dict_write_uint16(iter, MESSAGE_KEY_LOG_REPS, reps);
    dict_write_uint32(iter, MESSAGE_KEY_LOG_WEIGHT, weight);
    dict_write_uint8(iter, MESSAGE_KEY_LOG_STATUS, completed ? 1 : 0);
    app_message_outbox_send();
  }
}

// Send workout action (1 = Finish, 2 = Cancel)
static void send_workout_action(int action) {
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  if (iter) {
    dict_write_uint8(iter, MESSAGE_KEY_WORKOUT_ACTION, action);
    app_message_outbox_send();
  }
}

// Request routine sync from phone
static void send_request_sync() {
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  if (iter) {
    dict_write_uint8(iter, MESSAGE_KEY_WORKOUT_ACTION, 0); // 0 = SYNC/REQUEST
    app_message_outbox_send();
  }
}

// Format weight values (kg or lbs)
static void format_weight(char *buf, size_t buf_len, int weight, int unit) {
  int whole = weight / 100;
  int fraction = weight % 100;
  char *unit_str = (unit == UNIT_LBS) ? "lbs" : "kg";
  
  if (fraction == 0) {
    snprintf(buf, buf_len, "%d %s", whole, unit_str);
  } else {
    snprintf(buf, buf_len, "%d.%02d %s", whole, fraction, unit_str);
  }
}

// Timer tick callback
static void timer_callback(void *data) {
  if (s_rest_seconds_left > 0) {
    s_rest_seconds_left--;
    layer_mark_dirty(s_workout_layer);
    s_rest_timer = app_timer_register(1000, timer_callback, NULL);
  } else {
    s_rest_timer = NULL;
    // Notify user rest is over with a double pulse haptic alert
    vibes_double_pulse();
  }
}

// Sync window drawing proc (waiting for routine sync)
static void sync_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  
  // Background
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  
  graphics_context_set_text_color(ctx, GColorWhite);
  
  if (s_expected_exercise_count > 0) {
    // Syncing in progress
    static char sync_buf[48];
    int progress = (s_exercise_count * 100) / s_expected_exercise_count;
    snprintf(sync_buf, sizeof(sync_buf), translate("Lade Plan...\n%d%%", "Loading Routine...\n%d%%"), progress);
    
    graphics_draw_text(ctx, sync_buf, s_main_font,
                       GRect(10, bounds.size.h / 2 - 30, bounds.size.w - 20, 60),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  } else {
    // Idle/Waiting
    graphics_draw_text(ctx, "PebbleGym", s_title_font,
                       GRect(10, 20, bounds.size.w - 20, 30),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                       
    graphics_draw_text(ctx, translate("Wähle einen Plan mit SELECT oder starte ein Workout auf dem Handy.", "Select a routine with SELECT or start a workout on your phone."), s_label_font,
                       GRect(10, bounds.size.h / 2 - 30, bounds.size.w - 20, 70),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                       
    graphics_draw_text(ctx, translate("SEL: Pläne | UP: Sync anfordern", "SEL: Routines | UP: Request Sync"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(10, bounds.size.h - 25, bounds.size.w - 20, 20),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  }
}

// Main workout tracking window drawing proc
static void workout_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  
  // Clean background
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  
  if (s_exercise_count == 0) return;
  
  ExerciseData *active_ex = &s_exercises[s_current_exercise_idx];
  SetData *active_set = &active_ex->sets[s_current_set_idx];
  
  // 1. Header Area (Exercise Title)
  int header_h = 34;
  graphics_context_set_fill_color(ctx, GColorCobaltBlue);
  graphics_fill_rect(ctx, GRect(0, 0, bounds.size.w, header_h), 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, GColorDarkGray);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(0, header_h - 1), GPoint(bounds.size.w, header_h - 1));
  
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, active_ex->name, s_label_font,
                     GRect(4, 4, bounds.size.w - 8, header_h - 8),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
                     
  // 2. Edit Mode drawing overlay
  if (s_edit_mode != EDIT_NONE) {
    graphics_context_set_text_color(ctx, GColorYellow);
    const char *edit_title = (s_edit_mode == EDIT_WEIGHT) ? translate("GEWICHT ÄNDERN", "EDIT WEIGHT") : translate("WIEDERHOLUNGEN", "REPETITIONS");
    graphics_draw_text(ctx, edit_title, s_label_font,
                       GRect(10, header_h + 10, bounds.size.w - 20, 20),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                       
    static char val_buf[24];
    if (s_edit_mode == EDIT_WEIGHT) {
      format_weight(val_buf, sizeof(val_buf), s_edit_weight, s_weight_unit);
    } else {
      snprintf(val_buf, sizeof(val_buf), translate("%d Wdh.", "%d Reps"), s_edit_reps);
    }
    
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, val_buf, s_main_font,
                       GRect(10, header_h + 35, bounds.size.w - 20, 36),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                       
    graphics_context_set_text_color(ctx, GColorLightGray);
    graphics_draw_text(ctx, translate("UP/DN: Wert | SEL: Sichern", "UP/DN: Value | SEL: Save"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(10, bounds.size.h - 32, bounds.size.w - 20, 16),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, translate("BACK: Abbrechen", "BACK: Cancel"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(10, bounds.size.h - 18, bounds.size.w - 20, 16),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    return;
  }
  
  // 3. Normal Mode drawing
  // Draw Set Indices (e.g. "Satz 2 von 4")
  static char set_idx_buf[24];
  snprintf(set_idx_buf, sizeof(set_idx_buf), translate("Satz %d von %d", "Set %d of %d"), s_current_set_idx + 1, active_ex->set_count);
  graphics_context_set_text_color(ctx, GColorLightGray);
  graphics_draw_text(ctx, set_idx_buf, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(10, header_h + 4, bounds.size.w - 20, 18),
                     GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                     
  // Draw Target values (e.g. "10 x 82.5 kg")
  static char target_buf[32];
  static char weight_str[16];
  format_weight(weight_str, sizeof(weight_str), active_set->weight, s_weight_unit);
  snprintf(target_buf, sizeof(target_buf), "%d x %s", active_set->reps, weight_str);
  
  graphics_context_set_text_color(ctx, active_set->completed ? GColorIslamicGreen : GColorYellow);
  graphics_draw_text(ctx, target_buf, s_main_font,
                     GRect(10, header_h + 20, bounds.size.w - 20, 36),
                     GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                     
  // Draw Previous Stats (e.g. "Letztes Mal: 10 x 75 kg")
  if (active_set->prev_reps > 0) {
    static char prev_buf[48];
    static char prev_weight_str[16];
    format_weight(prev_weight_str, sizeof(prev_weight_str), active_set->prev_weight, s_weight_unit);
    snprintf(prev_buf, sizeof(prev_buf), translate("Letztes Mal: %d x %s", "Last time: %d x %s"), active_set->prev_reps, prev_weight_str);
    
    graphics_context_set_text_color(ctx, GColorLightGray);
    graphics_draw_text(ctx, prev_buf, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(10, header_h + 54, bounds.size.w - 20, 18),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  }
  
  // Draw Progress dots
  int dot_r = 5;
  int gap = 8;
  int total_dots_w = (active_ex->set_count * (dot_r * 2)) + ((active_ex->set_count - 1) * gap);
  int start_x = (bounds.size.w - total_dots_w) / 2;
  int dot_y = header_h + 76;
  
  for (int d = 0; d < active_ex->set_count; d++) {
    int cx = start_x + d * (dot_r * 2 + gap) + dot_r;
    graphics_context_set_stroke_width(ctx, 1);
    
    if (d == s_current_set_idx) {
      // Active set dot: yellow ring + yellow fill (or glowing)
      graphics_context_set_stroke_color(ctx, GColorYellow);
      graphics_draw_circle(ctx, GPoint(cx, dot_y), dot_r + 2);
    }
    
    if (active_ex->sets[d].completed) {
      graphics_context_set_fill_color(ctx, GColorIslamicGreen);
      graphics_fill_circle(ctx, GPoint(cx, dot_y), dot_r);
    } else if (active_ex->sets[d].skipped) {
      graphics_context_set_fill_color(ctx, GColorRed);
      graphics_fill_circle(ctx, GPoint(cx, dot_y), dot_r);
    } else {
      // Pending set: empty gray border
      graphics_context_set_stroke_color(ctx, GColorDarkGray);
      graphics_draw_circle(ctx, GPoint(cx, dot_y), dot_r);
    }
  }

  // Draw Rest Timer Overlay if active
  if (s_rest_seconds_left > 0) {
    int timer_h = 42;
    int timer_y = bounds.size.h - timer_h;
    
    // Background bar
    graphics_context_set_fill_color(ctx, GColorClear);
    graphics_fill_rect(ctx, GRect(0, timer_y, bounds.size.w, timer_h), 0, GCornerNone);
    
    // Draw neon-blue progress bar at the very top of timer box
    int bar_w = (s_rest_seconds_left * bounds.size.w) / s_rest_seconds;
    graphics_context_set_fill_color(ctx, GColorCyan);
    graphics_fill_rect(ctx, GRect(0, timer_y, bar_w, 4), 0, GCornerNone);
    
    // Timer Text
    static char timer_buf[24];
    snprintf(timer_buf, sizeof(timer_buf), translate("PAUSE: %d s", "REST: %d s"), s_rest_seconds_left);
    graphics_context_set_text_color(ctx, GColorCyan);
    graphics_draw_text(ctx, timer_buf, s_label_font,
                       GRect(10, timer_y + 10, bounds.size.w - 20, 24),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
                       
    // Hint to dismiss timer
    graphics_context_set_text_color(ctx, GColorDarkGray);
    graphics_draw_text(ctx, translate("BACK: Pause überspringen", "BACK: Skip Rest"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(10, timer_y + 26, bounds.size.w - 20, 14),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  } else {
    // Normal instructions footer
    graphics_context_set_text_color(ctx, GColorLightGray);
    graphics_draw_text(ctx, translate("SEL (Halten): Log Satz | SEL: Übungen", "SEL (Hold): Log Set | SEL: Exercises"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(6, bounds.size.h - 30, bounds.size.w - 12, 14),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, translate("UP/DN (Halten): Ändern Wds./Gew.", "UP/DN (Hold): Edit Reps/Weight"), fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(6, bounds.size.h - 16, bounds.size.w - 12, 14),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  }
}

// Workout click handler
static void workout_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode == EDIT_WEIGHT) {
    s_edit_weight += 250; // +2.5 kg/lbs
    layer_mark_dirty(s_workout_layer);
  } else if (s_edit_mode == EDIT_REPS) {
    s_edit_reps += 1; // +1 rep
    layer_mark_dirty(s_workout_layer);
  } else {
    // Scroll sets up
    if (s_current_set_idx > 0) {
      s_current_set_idx--;
      layer_mark_dirty(s_workout_layer);
    }
  }
}

static void workout_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode == EDIT_WEIGHT) {
    if (s_edit_weight >= 250) s_edit_weight -= 250;
    layer_mark_dirty(s_workout_layer);
  } else if (s_edit_mode == EDIT_REPS) {
    if (s_edit_reps > 0) s_edit_reps -= 1;
    layer_mark_dirty(s_workout_layer);
  } else {
    // Scroll sets down
    ExerciseData *active_ex = &s_exercises[s_current_exercise_idx];
    if (s_current_set_idx < active_ex->set_count - 1) {
      s_current_set_idx++;
      layer_mark_dirty(s_workout_layer);
    }
  }
}

static void workout_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode != EDIT_NONE) {
    // Confirm edit
    ExerciseData *active_ex = &s_exercises[s_current_exercise_idx];
    SetData *active_set = &active_ex->sets[s_current_set_idx];
    
    if (s_edit_mode == EDIT_WEIGHT) {
      active_set->weight = s_edit_weight;
    } else if (s_edit_mode == EDIT_REPS) {
      active_set->reps = s_edit_reps;
    }
    s_edit_mode = EDIT_NONE;
    layer_mark_dirty(s_workout_layer);
    vibes_short_pulse();
  } else {
    // Open Quick Exercise Menu
    if (!s_exercise_menu_window) {
      s_exercise_menu_window = window_create();
      window_set_window_handlers(s_exercise_menu_window, (WindowHandlers) {
        .load = exercise_menu_window_load,
        .unload = exercise_menu_window_unload
      });
    }
    window_stack_push(s_exercise_menu_window, true);
  }
}

static void workout_select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode != EDIT_NONE) return;
  
  // Mark set as done!
  ExerciseData *active_ex = &s_exercises[s_current_exercise_idx];
  SetData *active_set = &active_ex->sets[s_current_set_idx];
  
  active_set->completed = true;
  active_set->skipped = false;
  active_set->logged_reps = active_set->reps;
  active_set->logged_weight = active_set->weight;
  
  // Log immediately to phone
  send_logged_set(s_current_exercise_idx, s_current_set_idx, active_set->logged_reps, active_set->logged_weight, true);
  
  // Short haptic confirm
  vibes_short_pulse();
  
  // Reset and start pause/rest timer
  if (s_rest_seconds > 0) {
    s_rest_seconds_left = s_rest_seconds;
    if (s_rest_timer) {
      app_timer_cancel(s_rest_timer);
    }
    s_rest_timer = app_timer_register(1000, timer_callback, NULL);
  }
  
  // Increment set index
  if (s_current_set_idx < active_ex->set_count - 1) {
    s_current_set_idx++;
  }
  
  layer_mark_dirty(s_workout_layer);
}

static void workout_up_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode != EDIT_NONE) return;
  
  // Enter Edit Weight
  s_edit_mode = EDIT_WEIGHT;
  s_edit_weight = s_exercises[s_current_exercise_idx].sets[s_current_set_idx].weight;
  layer_mark_dirty(s_workout_layer);
  vibes_short_pulse();
}

static void workout_down_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode != EDIT_NONE) return;
  
  // Enter Edit Reps
  s_edit_mode = EDIT_REPS;
  s_edit_reps = s_exercises[s_current_exercise_idx].sets[s_current_set_idx].reps;
  layer_mark_dirty(s_workout_layer);
  vibes_short_pulse();
}

static void workout_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_edit_mode != EDIT_NONE) {
    // Cancel editing
    s_edit_mode = EDIT_NONE;
    layer_mark_dirty(s_workout_layer);
    vibes_short_pulse();
  } else if (s_rest_seconds_left > 0) {
    // Dismiss active rest timer
    if (s_rest_timer) {
      app_timer_cancel(s_rest_timer);
      s_rest_timer = NULL;
    }
    s_rest_seconds_left = 0;
    layer_mark_dirty(s_workout_layer);
    vibes_short_pulse();
  } else {
    // Open Quick Exercise Menu to force user to choose Finish or Cancel, or select exercise
    if (!s_exercise_menu_window) {
      s_exercise_menu_window = window_create();
      window_set_window_handlers(s_exercise_menu_window, (WindowHandlers) {
        .load = exercise_menu_window_load,
        .unload = exercise_menu_window_unload
      });
    }
    window_stack_push(s_exercise_menu_window, true);
  }
}

// Click config provider for workout
static void workout_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, workout_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, workout_down_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, workout_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, workout_back_click_handler);
  
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, workout_select_long_click_handler, NULL);
  window_long_click_subscribe(BUTTON_ID_UP, 600, workout_up_long_click_handler, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 600, workout_down_long_click_handler, NULL);
}

// AppMessage inbox handler
static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  // Check for language update
  Tuple *lang_t = dict_find(iter, MESSAGE_KEY_LANGUAGE);
  if (lang_t) {
    s_language = lang_t->value->uint8;
    persist_write_int(PERSIST_KEY_LANGUAGE, s_language);
    // Redraw UI with new language
    if (s_sync_layer) layer_mark_dirty(s_sync_layer);
    if (s_workout_layer) layer_mark_dirty(s_workout_layer);
    if (s_routine_menu_layer) menu_layer_reload_data(s_routine_menu_layer);
    if (s_exercise_menu_layer) menu_layer_reload_data(s_exercise_menu_layer);
  }

  // 1. Sync start action: WORKOUT_ACTION=0
  Tuple *action_tuple = dict_find(iter, MESSAGE_KEY_WORKOUT_ACTION);
  if (action_tuple && action_tuple->value->uint8 == 0) {
    Tuple *set_count_t = dict_find(iter, MESSAGE_KEY_SET_COUNT); // overloaded: total exercises
    if (set_count_t) {
      s_expected_exercise_count = set_count_t->value->uint16;
      s_exercise_count = 0;
      s_workout_in_progress = false;
      
      // Parse settings: weight unit & rest timer
      Tuple *unit_t = dict_find(iter, MESSAGE_KEY_PREV_REPS);
      if (unit_t) s_weight_unit = unit_t->value->uint16;
      
      Tuple *rest_t = dict_find(iter, MESSAGE_KEY_PREV_WEIGHT);
      if (rest_t) s_rest_seconds = rest_t->value->uint32;
      
      layer_mark_dirty(s_sync_layer);
    }
    return;
  }

  // 3. Routines List Count & Active ID
  Tuple *rot_count_t = dict_find(iter, MESSAGE_KEY_ROUTINE_COUNT);
  if (rot_count_t) {
    s_routine_count = rot_count_t->value->uint8;
    if (s_routine_count > MAX_ROUTINES) {
      s_routine_count = MAX_ROUTINES;
    }
    Tuple *active_id_t = dict_find(iter, MESSAGE_KEY_ACTIVE_ROUTINE_ID);
    if (active_id_t) {
      snprintf(s_active_routine_id, sizeof(s_active_routine_id), "%s", active_id_t->value->cstring);
    }
    // Refresh routine menu layer if open
    if (s_routine_menu_layer) {
      menu_layer_reload_data(s_routine_menu_layer);
    }
    return;
  }

  // 4. Routine Chunk Details
  Tuple *rot_idx_t = dict_find(iter, MESSAGE_KEY_ROUTINE_INDEX);
  if (rot_idx_t) {
    uint8_t r_idx = rot_idx_t->value->uint8;
    if (r_idx < MAX_ROUTINES) {
      Tuple *r_id_t = dict_find(iter, MESSAGE_KEY_ROUTINE_ID);
      Tuple *r_name_t = dict_find(iter, MESSAGE_KEY_ROUTINE_NAME);
      if (r_id_t && r_name_t) {
        snprintf(s_routines[r_idx].id, sizeof(s_routines[r_idx].id), "%s", r_id_t->value->cstring);
        snprintf(s_routines[r_idx].name, sizeof(s_routines[r_idx].name), "%s", r_name_t->value->cstring);
      }
    }
    // Refresh routine menu layer if open
    if (s_routine_menu_layer) {
      menu_layer_reload_data(s_routine_menu_layer);
    }
    return;
  }
  
  // 2. Exercise Chunk
  Tuple *ex_idx_t = dict_find(iter, MESSAGE_KEY_EXERCISE_INDEX);
  if (ex_idx_t) {
    uint16_t ex_idx = ex_idx_t->value->uint16;
    if (ex_idx < MAX_EXERCISES) {
      Tuple *ex_name_t = dict_find(iter, MESSAGE_KEY_EXERCISE_NAME);
      Tuple *set_count_t = dict_find(iter, MESSAGE_KEY_SET_COUNT);
      
      if (ex_name_t && set_count_t) {
        // Exercise Metadata
        snprintf(s_exercises[ex_idx].name, sizeof(s_exercises[ex_idx].name), "%s", ex_name_t->value->cstring);
        s_exercises[ex_idx].set_count = set_count_t->value->uint16;
        s_exercises[ex_idx].index = ex_idx;
        
        if (ex_idx >= s_exercise_count) {
          s_exercise_count = ex_idx + 1;
        }
        
        // Init sets to blank targets
        for (int s = 0; s < MAX_SETS_PER_EX; s++) {
          s_exercises[ex_idx].sets[s].reps = 0;
          s_exercises[ex_idx].sets[s].weight = 0;
          s_exercises[ex_idx].sets[s].completed = false;
          s_exercises[ex_idx].sets[s].skipped = false;
        }
        
        layer_mark_dirty(s_sync_layer);
      } else {
        // Set Detail Chunk
        Tuple *set_idx_t = dict_find(iter, MESSAGE_KEY_SET_INDEX);
        Tuple *target_reps_t = dict_find(iter, MESSAGE_KEY_TARGET_REPS);
        Tuple *target_weight_t = dict_find(iter, MESSAGE_KEY_TARGET_WEIGHT);
        Tuple *prev_reps_t = dict_find(iter, MESSAGE_KEY_PREV_REPS);
        Tuple *prev_weight_t = dict_find(iter, MESSAGE_KEY_PREV_WEIGHT);
        
        if (set_idx_t && target_reps_t && target_weight_t) {
          uint16_t set_idx = set_idx_t->value->uint16;
          if (set_idx < MAX_SETS_PER_EX) {
            SetData *set = &s_exercises[ex_idx].sets[set_idx];
            set->index = set_idx;
            set->reps = target_reps_t->value->uint16;
            set->weight = target_weight_t->value->uint32;
            set->prev_reps = prev_reps_t ? prev_reps_t->value->uint16 : 0;
            set->prev_weight = prev_weight_t ? prev_weight_t->value->uint32 : 0;
            
            // Check if final packet received
            if (ex_idx == s_expected_exercise_count - 1 && set_idx == s_exercises[ex_idx].set_count - 1) {
              s_workout_in_progress = true;
              s_current_exercise_idx = 0;
              s_current_set_idx = 0;
              s_edit_mode = EDIT_NONE;
              s_rest_seconds_left = 0;
              if (s_rest_timer) {
                app_timer_cancel(s_rest_timer);
                s_rest_timer = NULL;
              }
              
              // Transition to workout screen
              window_stack_push(s_workout_window, true);
              
              // Vibrate watch to announce sync success
              vibes_double_pulse();
            }
          }
        }
      }
    }
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "PebbleGym: Inbox dropped: %d", reason);
}

// Sync Window button clicks (UP to request manual sync, SELECT to show routines)
static void sync_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  send_request_sync();
  vibes_short_pulse();
}

static void sync_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (!s_routine_menu_window) {
    s_routine_menu_window = window_create();
    window_set_window_handlers(s_routine_menu_window, (WindowHandlers) {
      .load = routine_menu_window_load,
      .unload = routine_menu_window_unload
    });
  }
  window_stack_push(s_routine_menu_window, true);
  vibes_short_pulse();
}

static void sync_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, sync_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, sync_select_click_handler);
}

// Window load/unload callbacks
static void sync_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  s_sync_layer = layer_create(bounds);
  layer_set_update_proc(s_sync_layer, sync_layer_update_proc);
  layer_add_child(window_layer, s_sync_layer);
  
  window_set_click_config_provider(window, sync_click_config_provider);
}

static void sync_window_unload(Window *window) {
  layer_destroy(s_sync_layer);
}

static void workout_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  s_workout_layer = layer_create(bounds);
  layer_set_update_proc(s_workout_layer, workout_layer_update_proc);
  layer_add_child(window_layer, s_workout_layer);
  
  window_set_click_config_provider(window, workout_click_config_provider);
}

static void workout_window_unload(Window *window) {
  layer_destroy(s_workout_layer);
  s_workout_in_progress = false;
  s_expected_exercise_count = 0;
  s_exercise_count = 0;
  
  if (s_rest_timer) {
    app_timer_cancel(s_rest_timer);
    s_rest_timer = NULL;
  }
  s_rest_seconds_left = 0;
  
  // Redraw sync screen
  layer_mark_dirty(s_sync_layer);
}

// Quick Exercise Selection Menu Layer Callbacks
static uint16_t menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  // Total exercises + 2 action rows (Beenden, Abbrechen)
  return s_exercise_count + 2;
}

static void menu_draw_row_callback(GContext* ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
  int idx = cell_index->row;
  
  if (idx < s_exercise_count) {
    // Normal exercise item
    ExerciseData *ex = &s_exercises[idx];
    
    // Count completed sets
    int completed_sets = 0;
    for (int s = 0; s < ex->set_count; s++) {
      if (ex->sets[s].completed) completed_sets++;
    }
    
    static char sub_buf[28];
    snprintf(sub_buf, sizeof(sub_buf), translate("%d Sätze (%d fertig)", "%d sets (%d done)"), ex->set_count, completed_sets);
    
    menu_cell_basic_draw(ctx, cell_layer, ex->name, sub_buf, NULL);
  } else if (idx == s_exercise_count) {
    // Action item: Finish Workout
    menu_cell_basic_draw(ctx, cell_layer, translate("Workout BEENDEN", "FINISH Workout"), translate("Abschließen & speichern", "Finish & save"), NULL);
  } else if (idx == s_exercise_count + 1) {
    // Action item: Cancel Workout
    menu_cell_basic_draw(ctx, cell_layer, translate("Abbrechen", "Cancel"), translate("Verwerfen", "Discard"), NULL);
  }
}

static void menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  int idx = cell_index->row;
  
  if (idx < s_exercise_count) {
    // Jump to selected exercise
    s_current_exercise_idx = idx;
    
    // Auto find the first incomplete set of this exercise
    int first_incomplete = 0;
    for (int s = 0; s < s_exercises[idx].set_count; s++) {
      if (!s_exercises[idx].sets[s].completed) {
        first_incomplete = s;
        break;
      }
    }
    s_current_set_idx = first_incomplete;
    
    // Pop menu and return to workout UI
    window_stack_pop(true);
    layer_mark_dirty(s_workout_layer);
  } else if (idx == s_exercise_count) {
    // Finish Workout
    send_workout_action(1); // 1 = FINISH
    s_workout_in_progress = false;
    
    // Double pop to return to sync screen
    window_stack_pop(false); // Pop Menu Layer
    window_stack_pop(true);  // Pop Workout Window
    
    vibes_double_pulse();
  } else if (idx == s_exercise_count + 1) {
    // Cancel Workout (immediate discard)
    send_workout_action(2); // 2 = CANCEL
    s_workout_in_progress = false;
    
    window_stack_pop(false); // Pop Menu Layer
    window_stack_pop(true);  // Pop Workout Window
    
    vibes_short_pulse();
  }
}

static void exercise_menu_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  s_exercise_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_exercise_menu_layer, NULL, (MenuLayerCallbacks){
    .get_num_rows = menu_get_num_rows_callback,
    .draw_row = menu_draw_row_callback,
    .select_click = menu_select_callback,
  });
  
  menu_layer_set_click_config_onto_window(s_exercise_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_exercise_menu_layer));
}

static void exercise_menu_window_unload(Window *window) {
  menu_layer_destroy(s_exercise_menu_layer);
}

// Routine Selection Menu callbacks
static uint16_t routine_menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  return s_routine_count == 0 ? 1 : s_routine_count;
}

static void routine_menu_draw_row_callback(GContext* ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
  if (s_routine_count == 0) {
    menu_cell_basic_draw(ctx, cell_layer, translate("Keine Pläne", "No routines"), translate("Handy-Einstell. prüfen", "Check phone settings"), NULL);
    return;
  }
  
  int idx = cell_index->row;
  RoutineHeader *r = &s_routines[idx];
  bool is_active = (strcmp(r->id, s_active_routine_id) == 0);
  
  char subtitle[32];
  if (is_active) {
    snprintf(subtitle, sizeof(subtitle), "%s", translate("Aktiv (Ausgewählt)", "Active (Selected)"));
  } else {
    snprintf(subtitle, sizeof(subtitle), "%s", translate("Klicken zum Starten", "Click to start"));
  }
  
  menu_cell_basic_draw(ctx, cell_layer, r->name, subtitle, NULL);
}

static void routine_menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
  if (s_routine_count == 0) return;
  
  int idx = cell_index->row;
  RoutineHeader *r = &s_routines[idx];
  
  // Send activate action and routine ID to phone companion FIRST
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  if (iter) {
    dict_write_uint8(iter, MESSAGE_KEY_WORKOUT_ACTION, 3); // 3 = ACTIVATE_ROUTINE
    dict_write_cstring(iter, MESSAGE_KEY_ACTIVE_ROUTINE_ID, r->id);
    app_message_outbox_send();
  }
  
  // Pop routine list menu to return to sync view
  window_stack_pop(true);
  
  vibes_short_pulse();
}

static void routine_menu_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  s_routine_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_routine_menu_layer, NULL, (MenuLayerCallbacks){
    .get_num_rows = routine_menu_get_num_rows_callback,
    .draw_row = routine_menu_draw_row_callback,
    .select_click = routine_menu_select_callback,
  });
  
  menu_layer_set_click_config_onto_window(s_routine_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_routine_menu_layer));
}

static void routine_menu_window_unload(Window *window) {
  menu_layer_destroy(s_routine_menu_layer);
}

static void outbox_failed_handler(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "PebbleGym: Outbox failed: %d", reason);
}

static void outbox_sent_handler(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "PebbleGym: Outbox sent successfully");
}

static void init(void) {
  if (persist_exists(PERSIST_KEY_LANGUAGE)) {
    s_language = persist_read_int(PERSIST_KEY_LANGUAGE);
  } else {
    s_language = LANG_DE;
  }

  // Create Fonts
  s_title_font = fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
  s_main_font = fonts_get_system_font(FONT_KEY_BITHAM_30_BLACK);
  s_label_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  
  // Create Main Windows
  s_sync_window = window_create();
  window_set_window_handlers(s_sync_window, (WindowHandlers) {
    .load = sync_window_load,
    .unload = sync_window_unload
  });
  
  s_workout_window = window_create();
  window_set_window_handlers(s_workout_window, (WindowHandlers) {
    .load = workout_window_load,
    .unload = workout_window_unload
  });
  
  // AppMessage configuration
  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_register_outbox_sent(outbox_sent_handler);
  app_message_open(512, 128);
  
  // Display initial waiting window
  window_stack_push(s_sync_window, true);
  
  // Request active routine sync on boot
  send_request_sync();
}

static void deinit(void) {
  window_destroy(s_sync_window);
  window_destroy(s_workout_window);
  if (s_exercise_menu_window) {
    window_destroy(s_exercise_menu_window);
  }
  if (s_routine_menu_window) {
    window_destroy(s_routine_menu_window);
  }
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
