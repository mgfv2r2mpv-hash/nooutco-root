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

  /* Start listening. Returns a stop function, always, even on the paths that
     fail: a caller holding a button down needs something to call on the way up
     and should not have to find out whether we got as far as a recogniser. */
  function listen(opts) {
    var o = opts || {};
    var Ctor = ctor();
    if (!Ctor) return function () {};

    var rec;
    try {
      rec = new Ctor();
    } catch (e) {
      if (o.onError) o.onError("unavailable");
      return function () {};
    }

    rec.continuous = true;
    // Interim results are what make it feel like it is listening rather than
    // thinking. Only the final ones are kept.
    rec.interimResults = true;
    rec.lang = o.lang || document.documentElement.lang || navigator.language || "en-US";

    /* WHERE THE PLATFORM CAN DO THIS WITHOUT THE NETWORK, ASK FOR THAT. It is a
       request the platform may ignore, not a guarantee, and nothing here is
       gated on it: he has ruled the network path acceptable, so a phone that
       cannot do it locally still gets to talk. Feature-detected rather than set
       blind, so an engine that has never heard of the property is not handed
       one it will carry around. */
    try {
      if ("processLocally" in rec) rec.processLocally = true;
    } catch (e) { /* the request is optional by design */ }

    var stopped = false;
    var stop = function () {
      if (stopped) return;
      stopped = true;
      try { rec.stop(); } catch (e) { /* already ended */ }
    };

    rec.onresult = function (ev) {
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
      /* "no-speech" and "aborted" are a person changing their mind, not a
         failure, and reporting them would put a warning in front of somebody
         who simply let go of the button. */
      var kind = (ev && ev.error) || "error";
      if (kind !== "no-speech" && kind !== "aborted" && o.onError) o.onError(kind);
      stopped = true;
    };

    rec.onend = function () {
      stopped = true;
      if (o.onEnd) o.onEnd();
    };

    try {
      rec.start();
    } catch (e) {
      // start() throws if one is already running. Ending that one is the
      // honest recovery: two recognisers would race for the same microphone.
      stopped = true;
      try { rec.abort(); } catch (e2) {}
      if (o.onError) o.onError("busy");
      if (o.onEnd) o.onEnd();
      return function () {};
    }

    return stop;
  }

  window.NoteSpeech = {
    available: available,
    listen: listen,
    // The sentence that carries his ruling into the interface. Exported rather
    // than typed into the component, so the rule has one home.
    RULE: "Say roles, not names.",
  };
})();
