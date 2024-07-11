# HTML Renderer

## How to run

### Default CasparCG template

_This is used for a HTML file that follows the typical CasparCG lifespan (`update(data); play(); stop()`)_

```bash
html-renderer.exe -- --url=file://C:/templates/mytemplate.html  outputPath="C:\\rendered" --screenshots=true --recording=true --recording-cropped=true --casparData='{"name":"John Doe"}' --casparDelay=1000
```

### Standalone HTML template

_This is used for a HTML file that doesn't require any additional input during its run._

```bash
html-renderer.exe -- --url=https://bouncingdvdlogo.com outputPath="C:\\rendered" --screenshots=true --recording=true --recording-cropped=false  --genericWaitIdle=1000 --genericWaitPlay=1000 --genericWaitStop=1000 --width=480 --height=320 --zoom=0.25
```

### Interactive mode

_This is used for HTML templates that require manual handling (like, external API calls need to be made)_

```bash
html-renderer.exe -- --url=https://bouncingdvdlogo.com outputPath=C:\\rendered --interactive=1
```

In interactive mode, commands are sent to the renderer via the console. The following commands are available:

```json

// Wait for this message before sending interactive messages.
    { "status": "ready" }


// Wait for the load event to be fired
    { "do": "waitForLoad" }
// Reply:
    { "reply": "waitForLoad" }

// Take a screenshot and save it as PNG
    { "do": "takeScreenshot", "fileName": "screenshot.png" }
// Reply:
    { "reply": "takeScreenshot" }
    { "reply": "takeScreenshot", "error": "Unable to write file \"screenshot.png\"" }

// Start recording
    { "do": "startRecording", "fileName": "recording.webm" }
// Reply:
    { "reply": "startRecording" }
    { "reply": "startRecording", "error": "Recording already started" }


// Stop recording
    { "do": "stopRecording" }
// Reply:
    { "reply": "stopRecording"}
    { "reply": "stopRecording", "error": "Unable to write file \"recording.webm\""  }

// Analyze the recording and crop it to only include the region with content
    { "do": "cropRecording", "fileName": "recording-cropped.webm" }
// Reply:
    { "reply": "cropRecording" }
    { "reply": "cropRecording", "error": "No recording found" }

// Execute javascript in the renderer
    { "do": "executeJs", "js": "update(\"myData\")" }
// Reply:
    { "reply": "executeJs" }
    { "reply": "executeJs", "error": "Some error" }

```
