/* Talking to the note instead of typing to it.
 *
 * WHY THIS IS THE STRONGEST SINGLE LEVER ON THE PAGE. Typing on a phone after a
 * session is the root canal. A technician who can hold a button and say "she
 * got aggressive when staff came in, three times, blocked each one, calmed in
 * about two minutes" and watch those particulars land in the right sections is
 * getting something the EHR cannot give them, which is the only durable reason
 * to open this tool rather than type into the EHR directly.
 *
 * HIS RULING, which is what allows this to exist at all: "This is acceptable
 * based on their privacy practices and their inability to access. Staff should
 * still avoid using client names on this surface so they should not be
 * dictating it to Apple as well. This will be part of their training that I
 * will do in person with them when I teach them to use it."
 *
 * Read that carefully, because the second half is the load bearing half. The
 * ruling makes the audio path acceptable AND asks staff to keep names off it.
 * A rule that lives only in a training session is a rule somebody forgets in
 * month four, so the interface carries it: the words "say roles, not names" sit
 * under the control, every time, as a label on the affordance rather than as an
 * alert in a queue. It costs the technician nothing and it is never not there.
 *
 * WHAT THIS CHANGES ABOUT OUR API CALLS: nothing. Recognition returns text, the
 * text goes into the same box typing goes into, and the same scrub tokenises
 * every name and identifier in it before any model sees it. The ruling changes
 * who hears the audio. It does not change what leaves this browser.
 *
 * Defines window.NoteSpeech. Plain script, not JSX, because nothing here draws.
 */
(function () {
  "use strict";

  function ctor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  /* A CAPABILITY CHECK, NOT A BROWSER CHECK. Sniffing for Safari would be wrong
     twice over: it would refuse a capable browser we did not think of, and it
     would offer the control on a Safari version that cannot do it. */
  function available() {
    return !!ctor();
  }

  /* WHAT EACH FAILURE SAYS. Chrome reports most failures as an error event after
     start() has already returned, so a caller that only resets its button leaves
     a person pressing a mic that does nothing and says nothing. Each kind that
     can actually happen gets a sentence that names the cause and the next move;
     a kind nobody planned for is shown by name rather than hidden. */
  var MESSAGES = {
    "not-allowed": "The microphone is blocked for this site. Allow it in the browser's site settings, then tap the mic again.",
    "service-not-allowed": "The browser's speech service is blocked for this site. Allow the microphone in the site settings, then tap the mic again.",
    "network": "Speech recognition could not reach its service. Check the connection, then tap the mic again.",
    "audio-capture": "No microphone was found. Plug one in or check the system input, then tap the mic again.",
    "language-not-supported": "This browser has no speech recognition for this language on this device. Type instead, or use the keyboard's dictation key.",
    "busy": "The microphone is already in use. Stop the other recording, then tap the mic again.",
    "unavailable": "Speech recognition could not start in this browser. Type instead, or use the keyboard's dictation key."
  };

  function describe(kind) {
    return MESSAGES[kind] || ("Speech recognition stopped (" + kind + "). Tap the mic to try again, or type instead.");
  }

  /* Start listening. Returns a stop function, always, even on the paths that
     fail: a caller holding a button down needs something to call on the way up
     and should not have to find out whether we got as far as a recogniser.

     ON-DEVICE RECOGNITION IS A HINT. Where the engine has a processLocally
     property it is set to true first, so audio stays on the device when it can.
     Chrome without the language pack answers that with language-not-supported
     after start() has returned, which used to leave the mic dead. That one kind,
     and only when the hint was in play, is retried once on a fresh recogniser
     with the hint left off, so dictation still works over the network path his
     ruling accepts. Anything else is reported as it happened. */
  function listen(opts) {
    var o = opts || {};
    var Ctor = ctor();
    if (!Ctor) return function () {};

    var current = null;     // the recogniser a stop should reach
    var wantStop = false;   // the caller let go; no retry, no restart
    var gen = 0;            // which attempt's events still count

    function fail(kind) {
      if (o.onError) o.onError(kind, describe(kind));
    }

    function attempt(useHint) {
      var mine = ++gen;
      var rec;
      try {
        rec = new Ctor();
      } catch (e) {
        fail("unavailable");
        if (o.onEnd) o.onEnd();
        return false;
      }
      current = rec;

      rec.continuous = true;
      // Interim results are what make it feel like it is listening rather than
      // thinking. Only the final ones are kept.
      rec.interimResults = true;
      rec.lang = o.lang || document.documentElement.lang || navigator.language || "en-US";

      var hinted = false;
      try {
        if (useHint && "processLocally" in rec) { rec.processLocally = true; hinted = true; }
      } catch (e) { /* the request is optional by design */ }

      rec.onresult = function (ev) {
        if (mine !== gen) return;
        var settled = "";
        var pending = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          var said = (r[0] && r[0].transcript) || "";
          if (r.isFinal) settled += said;
          else pending += said;
        }
        if (settled && o.onText) o.onText(settled);
        if (o.onPartial) o.onPartial(pending);
      };

      rec.onerror = function (ev) {
        if (mine !== gen) return;
        /* "no-speech" and "aborted" are a person changing their mind, not a
           failure, and reporting them would put a warning in front of somebody
           who simply let go of the button. */
        var kind = (ev && ev.error) || "error";
        if (kind === "no-speech" || kind === "aborted") return;
        if (kind === "language-not-supported" && hinted && !wantStop) {
          // Supersede this attempt so its end event is not reported, then go
          // again without the hint.
          gen += 1;
          attempt(false);
          return;
        }
        gen += 1;
        wantStop = true;
        fail(kind);
        if (o.onEnd) o.onEnd();
      };

      rec.onend = function () {
        if (mine !== gen) return;
        wantStop = true;
        if (o.onEnd) o.onEnd();
      };

      try {
        rec.start();
      } catch (e) {
        // start() throws if one is already running. Ending that one is the
        // honest recovery: two recognisers would race for the same microphone.
        gen += 1;
        wantStop = true;
        try { rec.abort(); } catch (e2) {}
        fail("busy");
        if (o.onEnd) o.onEnd();
        return false;
      }
      return true;
    }

    attempt(true);

    return function stop() {
      if (wantStop) return;
      wantStop = true;
      try { if (current) current.stop(); } catch (e) { /* already ended */ }
    };
  }

  window.NoteSpeech = {
    available: available,
    listen: listen,
    describe: describe,
    // The sentence that carries his ruling into the interface. Exported rather
    // than typed into the component, so the rule has one home.
    RULE: "Say roles, not names.",
  };
})();
