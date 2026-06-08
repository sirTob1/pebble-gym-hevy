// Pebble Gym Workout Companion - PebbleKit JS (ES5)

var syncQueue = [];
var isSyncing = false;

// Hardcoded key mapping for runtimes like Gadgetbridge (ensuring we don't rely solely on injected globals)
var myMessageKeys = {
  "ACTIVE_ROUTINE_ID": 10018,
  "EXERCISE_INDEX": 10000,
  "EXERCISE_NAME": 10001,
  "LANGUAGE": 10019,
  "LOG_EXERCISE_INDEX": 10009,
  "LOG_REPS": 10011,
  "LOG_SET_INDEX": 10010,
  "LOG_STATUS": 10013,
  "LOG_WEIGHT": 10012,
  "PREV_REPS": 10007,
  "PREV_WEIGHT": 10006,
  "ROUTINE_COUNT": 10014,
  "ROUTINE_ID": 10016,
  "ROUTINE_INDEX": 10015,
  "ROUTINE_NAME": 10017,
  "SET_COUNT": 10002,
  "SET_INDEX": 10003,
  "TARGET_REPS": 10005,
  "TARGET_WEIGHT": 10004,
  "WORKOUT_ACTION": 10008,
  "IS_TIMED": 10020,
  "TARGET_DURATION": 10021
};

// Helper to duplicate payload keys (both string and integer) to ensure compatibility on Gadgetbridge and other runtimes
function prepareMessage(msg) {
  var prepared = {};
  for (var key in msg) {
    if (msg.hasOwnProperty(key)) {
      prepared[key] = msg[key];
      // Use local mappings
      var intKey = myMessageKeys[key];
      if (intKey !== undefined) {
        prepared[intKey] = msg[key];
      }
      // Fallback to global messageKeys if injected
      if (typeof messageKeys !== 'undefined' && messageKeys[key] !== undefined) {
        prepared[messageKeys[key]] = msg[key];
      }
    }
  }
  return prepared;
}

// Helper: Process the AppMessage queue to avoid message collisions
function processSyncQueue() {
  if (syncQueue.length === 0) {
    isSyncing = false;
    console.log("PebbleGym JS: Sync queue is empty.");
    return;
  }
  isSyncing = true;
  var msg = syncQueue.shift();
  Pebble.sendAppMessage(msg, function() {
    // Success, process next message after a brief pause
    setTimeout(processSyncQueue, 40);
  }, function(err) {
    console.log("PebbleGym JS: Send failed, retrying... Error: " + JSON.stringify(err));
    syncQueue.unshift(msg);
    setTimeout(processSyncQueue, 500);
  });
}

function enqueueMessage(msg) {
  syncQueue.push(prepareMessage(msg));
  if (!isSyncing) {
    processSyncQueue();
  }
}

// Scrape and parse Hevy routine from raw html string or json
function parseHevyRoutine(htmlOrJson) {
  var routineData = null;
  
  // 1. Try parsing as raw JSON
  try {
    var parsed = JSON.parse(htmlOrJson);
    if (parsed.routine) {
      routineData = parsed.routine;
    } else if (parsed.title && parsed.exercises) {
      routineData = parsed;
    }
  } catch (e) {
    // 2. Extract from Next.js HTML page data
    var match = htmlOrJson.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (match) {
      try {
        var data = JSON.parse(match[1]);
        if (data.props && data.props.pageProps && data.props.pageProps.routine) {
          routineData = data.props.pageProps.routine;
        } else if (data.props && data.props.pageProps && data.props.pageProps.initialState && data.props.pageProps.initialState.routine) {
          routineData = data.props.pageProps.initialState.routine;
        }
      } catch (err) {
        console.log("PebbleGym JS: Error parsing NEXT_DATA JSON: " + err);
      }
    }
  }
  
  if (!routineData) {
    console.log("PebbleGym JS: Could not find routine details in provided input.");
    return null;
  }
  
  var routine = {
    id: routineData.id ? routineData.id.toString() : "r_" + Date.now(),
    title: routineData.title || "Routine",
    exercises: []
  };
  
  var exercises = routineData.exercises || [];
  for (var i = 0; i < exercises.length; i++) {
    var ex = exercises[i];
    var exTitle = ex.title || (ex.exercise_template && ex.exercise_template.name) || "Exercise " + (i + 1);
    var sets = ex.sets || [];
    var cleanSets = [];
    
    for (var j = 0; j < sets.length; j++) {
      var s = sets[j];
      // weight_kg could be null/float. Store weight in kg * 100 as integer to avoid float issues in C
      var weight = s.weight_kg !== null && s.weight_kg !== undefined ? Math.round(s.weight_kg * 100) : 0;
      var isTimed = s.duration_seconds !== null && s.duration_seconds !== undefined && s.duration_seconds > 0;
      cleanSets.push({
        index: j,
        reps: s.reps !== null && s.reps !== undefined ? s.reps : 0,
        weight: weight,
        is_timed: isTimed || !!s.is_timed,
        target_duration: isTimed ? s.duration_seconds : (s.target_duration || 0)
      });
    }
    
    routine.exercises.push({
      index: i,
      name: exTitle,
      sets: cleanSets
    });
  }
  
  return routine;
}

// Fetch Hevy routine by URL
function fetchHevyRoutine(url, onSuccess, onError) {
  var shortId = null;
  var match = url.match(/\/routine\/([a-zA-Z0-9]+)/);
  if (match) {
    shortId = match[1];
  } else {
    var trimmed = url.trim();
    if (trimmed.length === 11 && /^[a-zA-Z0-9]+$/.test(trimmed)) {
      shortId = trimmed;
    }
  }

  if (!shortId) {
    onError("Invalid Hevy URL or Routine ID.");
    return;
  }

  var apiUrl = "https://api.hevyapp.com/routine_with_short_id/" + shortId;
  console.log("PebbleGym JS: Fetching routine via API: " + apiUrl);

  var xhr = new XMLHttpRequest();
  xhr.open("GET", apiUrl, true);
  xhr.setRequestHeader("x-api-key", "shelobs_hevy_web");
  xhr.setRequestHeader("Hevy-Platform", "web");
  xhr.setRequestHeader("Content-Type", "application/json");

  xhr.onload = function() {
    if (xhr.status === 200) {
      var routine = parseHevyRoutine(xhr.responseText);
      if (routine) {
        onSuccess(routine);
      } else {
        onError("Failed to parse routine from response JSON.");
      }
    } else {
      onError("HTTP error " + xhr.status);
    }
  };
  xhr.onerror = function() {
    onError("Network request failed.");
  };
  xhr.send();
}

// Retrieve past workout set details for history lookups
function getExerciseHistory(exerciseName, setIndex) {
  var history = [];
  try {
    history = JSON.parse(localStorage.getItem("workout_history") || "[]");
  } catch (e) {
    history = [];
  }
  
  // Look backwards for the most recent completed performance of this exercise
  for (var i = history.length - 1; i >= 0; i--) {
    var w = history[i];
    var exercises = w.exercises || [];
    for (var k = 0; k < exercises.length; k++) {
      var ex = exercises[k];
      if (ex.name.toLowerCase() === exerciseName.toLowerCase()) {
        var sets = ex.sets || [];
        // Match specific set index if possible, otherwise use the closest/last set
        if (sets[setIndex]) {
          return {
            weight: sets[setIndex].weight,
            reps: sets[setIndex].reps
          };
        } else if (sets.length > 0) {
          return {
            weight: sets[sets.length - 1].weight,
            reps: sets[sets.length - 1].reps
          };
        }
      }
    }
  }
  return null;
}

// Send active routine to watch (updates via Hevy link first if auto-reload is enabled)
function syncActiveRoutineToWatch(clearQueue) {
  var activeRoutineId = localStorage.getItem("active_routine_id");
  if (!activeRoutineId) {
    console.log("PebbleGym JS: No active routine selected.");
    return;
  }
  
  var routines = [];
  try {
    routines = JSON.parse(localStorage.getItem("saved_routines") || "[]");
  } catch (e) {
    routines = [];
  }
  
  var activeRoutine = null;
  for (var i = 0; i < routines.length; i++) {
    if (routines[i].id == activeRoutineId) {
      activeRoutine = routines[i];
      break;
    }
  }
  
  if (!activeRoutine) {
    console.log("PebbleGym JS: Active routine not found in saved list.");
    return;
  }

  var autoReload = localStorage.getItem("pebble_gym_auto_reload") === "true";

  function transmitRoutine(routine) {
    console.log("PebbleGym JS: Syncing routine data: " + routine.title);
    
    // Clear any pending sync messages unless explicitly requested otherwise
    if (clearQueue !== false) {
      syncQueue = [];
      isSyncing = false;
    }
    
    var isLbs = localStorage.getItem("pebble_gym_unit") === "lbs" ? 1 : 0;
    var restSec = parseInt(localStorage.getItem("pebble_gym_rest") || "90", 10);
    var activeLanguage = localStorage.getItem("pebble_gym_language") || "de";
    var langCode = (activeLanguage === "en") ? 1 : 0;

    // 1. Send start action: WORKOUT_ACTION=0, SET_COUNT = exercise count, PREV_REPS = weight unit, PREV_WEIGHT = rest timer duration, LANGUAGE = langCode
    enqueueMessage({
      WORKOUT_ACTION: 0,
      SET_COUNT: routine.exercises.length,
      PREV_REPS: isLbs,
      PREV_WEIGHT: restSec,
      LANGUAGE: langCode
    });
    
    // 2. Send exercises and their sets
    for (var i = 0; i < routine.exercises.length; i++) {
      var ex = routine.exercises[i];
      enqueueMessage({
        EXERCISE_INDEX: i,
        EXERCISE_NAME: ex.name.substring(0, 31),
        SET_COUNT: ex.sets.length
      });
      
      for (var j = 0; j < ex.sets.length; j++) {
        var s = ex.sets[j];
        var hist = getExerciseHistory(ex.name, j);
        enqueueMessage({
          EXERCISE_INDEX: i,
          SET_INDEX: j,
          TARGET_WEIGHT: s.weight,
          TARGET_REPS: s.reps,
          PREV_WEIGHT: hist ? hist.weight : 0,
          PREV_REPS: hist ? hist.reps : 0,
          IS_TIMED: s.is_timed ? 1 : 0,
          TARGET_DURATION: s.target_duration || 0
        });
      }
    }
  }

  // Check if we should update from Hevy link first
  if (autoReload && activeRoutine.hevy_link) {
    console.log("PebbleGym JS: Auto-reload enabled. Fetching latest routine from Hevy...");
    fetchHevyRoutine(activeRoutine.hevy_link, function(updatedRoutine) {
      console.log("PebbleGym JS: Routine updated successfully from Hevy: " + updatedRoutine.title);
      updatedRoutine.hevy_link = activeRoutine.hevy_link; // Keep the link
      
      // Update in saved_routines list
      for (var i = 0; i < routines.length; i++) {
        if (routines[i].id == activeRoutineId) {
          routines[i] = updatedRoutine;
          break;
        }
      }
      localStorage.setItem("saved_routines", JSON.stringify(routines));
      transmitRoutine(updatedRoutine);
    }, function(err) {
      console.log("PebbleGym JS: Failed to reload routine from Hevy (" + err + "). Syncing cached version.");
      transmitRoutine(activeRoutine);
    });
  } else {
    transmitRoutine(activeRoutine);
  }
}

// Send list of saved routines to the watch
function sendRoutinesListToWatch() {
  var routines = [];
  try {
    routines = JSON.parse(localStorage.getItem("saved_routines") || "[]");
  } catch (e) {
    routines = [];
  }
  
  var activeRoutineId = localStorage.getItem("active_routine_id") || "";
  var activeLanguage = localStorage.getItem("pebble_gym_language") || "de";
  var langCode = (activeLanguage === "en") ? 1 : 0;
  
  console.log("PebbleGym JS: Sending routines list to watch. Count: " + routines.length);
  
  // Clear sync queue to avoid collision
  syncQueue = [];
  isSyncing = false;
  
  // Send the count, active ID, and language first (active ID prefixed with 'id_' to avoid numeric type coercion by PebbleKit JS)
  enqueueMessage({
    ROUTINE_COUNT: routines.length,
    ACTIVE_ROUTINE_ID: "id_" + activeRoutineId,
    LANGUAGE: langCode
  });
  
  // Send each routine header
  for (var i = 0; i < routines.length; i++) {
    if (i >= 10) break; // Limit to 10 on watch
    var r = routines[i];
    enqueueMessage({
      ROUTINE_INDEX: i,
      ROUTINE_ID: "id_" + r.id.toString(),
      ROUTINE_NAME: r.title.substring(0, 31)
    });
  }
}

// Open settings page on phone
function openConfigPage() {
  var routines = localStorage.getItem("saved_routines") || "[]";
  var history = localStorage.getItem("workout_history") || "[]";
  var activeId = localStorage.getItem("active_routine_id") || "";
  
  var url = "https://sirtob1.github.io/pebble-gym-hevy/src/pkjs/config.html?v=" + Date.now() +
            "#" +
            "routines=" + encodeURIComponent(routines) +
            "&history=" + encodeURIComponent(history) +
            "&active_id=" + encodeURIComponent(activeId);
            
  console.log("PebbleGym JS: Opening config page: " + url.substring(0, 150) + "...");
  Pebble.openURL(url);
}

// Ready event
Pebble.addEventListener("ready", function() {
  console.log("PebbleGym JS: Ready!");
  sendRoutinesListToWatch();
});

// Show Configuration
Pebble.addEventListener("showConfiguration", function() {
  openConfigPage();
});

// WebView Closed
Pebble.addEventListener("webviewclosed", function(e) {
  if (e && e.response) {
    try {
      var settings = JSON.parse(decodeURIComponent(e.response));
      console.log("PebbleGym JS: Received settings response: " + JSON.stringify(settings).substring(0, 200));
      
      if (settings.saved_routines) {
        localStorage.setItem("saved_routines", JSON.stringify(settings.saved_routines));
      }
      if (settings.active_routine_id !== undefined) {
        localStorage.setItem("active_routine_id", settings.active_routine_id);
      }
      if (settings.workout_history) {
        localStorage.setItem("workout_history", JSON.stringify(settings.workout_history));
      }
      if (settings.language !== undefined) {
        localStorage.setItem("pebble_gym_language", settings.language);
      }
      
      // Handle background fetching of Hevy Link if provided
      if (settings.hevy_link) {
        console.log("PebbleGym JS: Fetching pending Hevy Link in background: " + settings.hevy_link);
        fetchHevyRoutine(settings.hevy_link, function(routine) {
          console.log("PebbleGym JS: Scrape success! Routine: " + routine.title);
          var saved = JSON.parse(localStorage.getItem("saved_routines") || "[]");
          var existingIdx = -1;
          for (var i = 0; i < saved.length; i++) {
            if (saved[i].id === routine.id) {
              existingIdx = i;
              break;
            }
          }
          if (existingIdx !== -1) {
            routine.hevy_link = settings.hevy_link;
            saved[existingIdx] = routine;
          } else {
            routine.hevy_link = settings.hevy_link;
            saved.push(routine);
          }
          localStorage.setItem("saved_routines", JSON.stringify(saved));
          localStorage.setItem("active_routine_id", routine.id);
          
          // Sync new routine to watch
          syncActiveRoutineToWatch();
        }, function(err) {
          console.log("PebbleGym JS: Background scrape failed: " + err);
        });
      } else {
        // Immediately sync active routine or routines list to watch
        if (localStorage.getItem("active_routine_id")) {
          syncActiveRoutineToWatch();
        } else {
          sendRoutinesListToWatch();
        }
      }
    } catch (err) {
      console.log("PebbleGym JS: Error parsing webview response: " + err);
    }
  }
});

// Global state to track active workout being logged
var activeWorkoutLog = null;

// Helper to get dictionary values supporting both string and integer keys (important for Gadgetbridge / older Pebble runtimes)
function getDictionaryValue(dict, keyName) {
  if (dict[keyName] !== undefined) {
    return dict[keyName];
  }
  // Try looking up the integer key from our own local map
  var intKey = myMessageKeys[keyName];
  if (intKey !== undefined && dict[intKey] !== undefined) {
    return dict[intKey];
  }
  // Fallback to global messageKeys if injected
  if (typeof messageKeys !== 'undefined' && messageKeys[keyName] !== undefined) {
    var globalIntKey = messageKeys[keyName];
    if (dict[globalIntKey] !== undefined) {
      return dict[globalIntKey];
    }
  }
  return undefined;
}

// AppMessage listener
Pebble.addEventListener("appmessage", function(e) {
  var dict = e.payload;
  console.log("PebbleGym JS: Received AppMessage: " + JSON.stringify(dict));
  
  var workoutAction = getDictionaryValue(dict, "WORKOUT_ACTION");
  var activeRoutineId = getDictionaryValue(dict, "ACTIVE_ROUTINE_ID");
  var logExerciseIndex = getDictionaryValue(dict, "LOG_EXERCISE_INDEX");
  var logSetIndex = getDictionaryValue(dict, "LOG_SET_INDEX");
  var logReps = getDictionaryValue(dict, "LOG_REPS");
  var logWeight = getDictionaryValue(dict, "LOG_WEIGHT");
  var logStatus = getDictionaryValue(dict, "LOG_STATUS");
  
  // Watch requests workout sync
  if (workoutAction === 0) {
    sendRoutinesListToWatch();
  }
  
  // Watch requests to activate a routine (3 = activate routine)
  if (workoutAction === 3 && activeRoutineId !== undefined && activeRoutineId !== null) {
    var routineId = activeRoutineId.toString();
    console.log("PebbleGym JS: Watch requested to activate routine: " + routineId);
    // Strip the 'id_' prefix if present
    if (routineId.indexOf("id_") === 0) {
      routineId = routineId.substring(3);
    }
    localStorage.setItem("active_routine_id", routineId);
    syncActiveRoutineToWatch(true);
  }
  
  // Watch requests active routine details (4 = request active routine details)
  if (workoutAction === 4) {
    console.log("PebbleGym JS: Watch requested active routine details.");
    syncActiveRoutineToWatch(true);
  }
  
  // Logging individual set
  if (logExerciseIndex !== undefined && logSetIndex !== undefined) {
    var exIdx = logExerciseIndex;
    var setIdx = logSetIndex;
    var reps = logReps;
    var weight = logWeight;
    var status = logStatus; // 1 = completed, 0 = skipped
    
    // Ensure active log exists
    if (!activeWorkoutLog) {
      var activeRoutineId = localStorage.getItem("active_routine_id");
      var routines = JSON.parse(localStorage.getItem("saved_routines") || "[]");
      var activeRoutine = null;
      for (var i = 0; i < routines.length; i++) {
        if (routines[i].id == activeRoutineId) {
          activeRoutine = routines[i];
          break;
        }
      }
      
      activeWorkoutLog = {
        routine_id: activeRoutineId || "manual",
        routine_title: activeRoutine ? activeRoutine.title : "Workout",
        timestamp: Date.now(),
        exercises: []
      };
    }
    
    // Find or create exercise in active log
    var exLog = null;
    for (var i = 0; i < activeWorkoutLog.exercises.length; i++) {
      if (activeWorkoutLog.exercises[i].index === exIdx) {
        exLog = activeWorkoutLog.exercises[i];
        break;
      }
    }
    
    if (!exLog) {
      // Find exercise name from active routine
      var exName = "Exercise " + (exIdx + 1);
      var activeRoutineId = localStorage.getItem("active_routine_id");
      var routines = JSON.parse(localStorage.getItem("saved_routines") || "[]");
      for (var i = 0; i < routines.length; i++) {
        if (routines[i].id === activeWorkoutLog.routine_id) {
          if (routines[i].exercises[exIdx]) {
            exName = routines[i].exercises[exIdx].name;
          }
          break;
        }
      }
      
      exLog = {
        index: exIdx,
        name: exName,
        sets: []
      };
      activeWorkoutLog.exercises.push(exLog);
    }
    
    // Log the set
    exLog.sets[setIdx] = {
      reps: reps,
      weight: weight,
      status: status
    };
    
    console.log("PebbleGym JS: Logged set " + setIdx + " of " + exLog.name + ": " + reps + " reps @ " + (weight/100) + " kg");
  }
  
  // Watch actions: FINISH (1) or CANCEL (2)
  if (workoutAction === 1) {
    if (activeWorkoutLog) {
      // Save to history
      var history = [];
      try {
        history = JSON.parse(localStorage.getItem("workout_history") || "[]");
      } catch (err) {
        history = [];
      }
      
      history.push(activeWorkoutLog);
      localStorage.setItem("workout_history", JSON.stringify(history));
      console.log("PebbleGym JS: Workout successfully saved to history.");
      
      activeWorkoutLog = null;
    }
  } else if (workoutAction === 2) {
    console.log("PebbleGym JS: Workout cancelled, discarding log.");
    activeWorkoutLog = null;
  }
});
