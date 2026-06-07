// Pebble Gym Workout Companion - PebbleKit JS (ES5)

var syncQueue = [];
var isSyncing = false;

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
  syncQueue.push(msg);
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
      cleanSets.push({
        index: j,
        reps: s.reps !== null && s.reps !== undefined ? s.reps : 0,
        weight: weight
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
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.onload = function() {
    if (xhr.status === 200) {
      var routine = parseHevyRoutine(xhr.responseText);
      if (routine) {
        onSuccess(routine);
      } else {
        onError("Failed to parse routine from page.");
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

// Send active routine to watch
function syncActiveRoutineToWatch() {
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
    if (routines[i].id === activeRoutineId) {
      activeRoutine = routines[i];
      break;
    }
  }
  
  if (!activeRoutine) {
    console.log("PebbleGym JS: Active routine not found in saved list.");
    return;
  }
  
  console.log("PebbleGym JS: Syncing routine: " + activeRoutine.title);
  
  // Clear any pending sync messages
  syncQueue = [];
  isSyncing = false;
  
  var isLbs = localStorage.getItem("pebble_gym_unit") === "lbs" ? 1 : 0;
  var restSec = parseInt(localStorage.getItem("pebble_gym_rest") || "90", 10);

  // 1. Send start action: WORKOUT_ACTION=0, SET_COUNT = exercise count, PREV_REPS = weight unit, PREV_WEIGHT = rest timer duration
  enqueueMessage({
    WORKOUT_ACTION: 0,
    SET_COUNT: activeRoutine.exercises.length,
    PREV_REPS: isLbs,
    PREV_WEIGHT: restSec
  });
  
  // 2. Send exercises and their sets
  for (var i = 0; i < activeRoutine.exercises.length; i++) {
    var ex = activeRoutine.exercises[i];
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
        PREV_REPS: hist ? hist.reps : 0
      });
    }
  }
}

// Open settings page on phone
function openConfigPage() {
  var routines = localStorage.getItem("saved_routines") || "[]";
  var history = localStorage.getItem("workout_history") || "[]";
  var activeId = localStorage.getItem("active_routine_id") || "";
  
  var url = "https://sirtob1.github.io/pebble-gym-hevy/src/pkjs/config.html?v=" + Date.now() +
            "&routines=" + encodeURIComponent(routines) +
            "&history=" + encodeURIComponent(history) +
            "&active_id=" + encodeURIComponent(activeId);
            
  console.log("PebbleGym JS: Opening config page: " + url.substring(0, 150) + "...");
  Pebble.openURL(url);
}

// Ready event
Pebble.addEventListener("ready", function() {
  console.log("PebbleGym JS: Ready!");
  // If watch requests active routine on start, we can trigger sync
  // syncActiveRoutineToWatch();
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
            saved[existingIdx] = routine;
          } else {
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
        // Immediately sync active routine to watch
        syncActiveRoutineToWatch();
      }
    } catch (err) {
      console.log("PebbleGym JS: Error parsing webview response: " + err);
    }
  }
});

// Global state to track active workout being logged
var activeWorkoutLog = null;

// AppMessage listener
Pebble.addEventListener("appmessage", function(e) {
  var dict = e.payload;
  console.log("PebbleGym JS: Received AppMessage: " + JSON.stringify(dict));
  
  // Watch requests workout sync
  if (dict.WORKOUT_ACTION === 0) {
    syncActiveRoutineToWatch();
  }
  
  // Logging individual set
  if (dict.LOG_EXERCISE_INDEX !== undefined && dict.LOG_SET_INDEX !== undefined) {
    var exIdx = dict.LOG_EXERCISE_INDEX;
    var setIdx = dict.LOG_SET_INDEX;
    var reps = dict.LOG_REPS;
    var weight = dict.LOG_WEIGHT;
    var status = dict.LOG_STATUS; // 1 = completed, 0 = skipped
    
    // Ensure active log exists
    if (!activeWorkoutLog) {
      var activeRoutineId = localStorage.getItem("active_routine_id");
      var routines = JSON.parse(localStorage.getItem("saved_routines") || "[]");
      var activeRoutine = null;
      for (var i = 0; i < routines.length; i++) {
        if (routines[i].id === activeRoutineId) {
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
  if (dict.WORKOUT_ACTION === 1) {
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
  } else if (dict.WORKOUT_ACTION === 2) {
    console.log("PebbleGym JS: Workout cancelled, discarding log.");
    activeWorkoutLog = null;
  }
});
