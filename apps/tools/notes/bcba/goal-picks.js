/* Goal picker rules for the supervision tool.
 *
 * WHAT THIS IS. The picker's logic with no DOM and no model call: which chips
 * are checked, the cap of six, which chip a seventh check evicts, whether the
 * picks differ from the grid, and the last text of a row that was dropped.
 *
 * STATE. { order, pre, user }. `order` is the strip order of every candidate
 * name. `pre` is the preselected names still checked. `user` is the names the
 * technician checked, oldest first. Every function returns a new state.
 *
 * CAP. A seventh check evicts the leftmost preselected chip still checked, and
 * once none is left, the oldest chip the technician checked.
 *
 * HELD TEXT. A dropped row's text is kept with the notes it was written from,
 * so rechecking restores it only while the notes are unchanged.
 */
(function () {
  "use strict";

  var CAP = 6;

  function inOrder(order, names) {
    return order.filter(function (n) { return names.indexOf(n) !== -1; });
  }

  function init(candidates) {
    var order = (candidates.order || []).slice();
    return { order: order, pre: inOrder(order, candidates.preselected || []), user: [] };
  }

  function checked(state) {
    var all = state.pre.concat(state.user);
    return inOrder(state.order, all);
  }

  function toggle(state, name) {
    if (state.order.indexOf(name) === -1) return state;
    if (checked(state).indexOf(name) !== -1) {
      return {
        order: state.order,
        pre: state.pre.filter(function (n) { return n !== name; }),
        user: state.user.filter(function (n) { return n !== name; }),
      };
    }
    var pre = state.pre;
    var user = state.user.concat([name]);
    if (pre.length + user.length > CAP) {
      if (pre.length) pre = pre.slice(1);
      else user = user.slice(1);
    }
    return { order: state.order, pre: pre, user: user };
  }

  function sameSet(a, b) {
    return a.length === b.length && a.every(function (n) { return b.indexOf(n) !== -1; });
  }

  function differs(state, gridNames) {
    return !sameSet(checked(state), gridNames);
  }

  function plan(state, gridNames) {
    var picks = checked(state);
    return {
      added: picks.filter(function (n) { return gridNames.indexOf(n) === -1; }),
      removed: gridNames.filter(function (n) { return picks.indexOf(n) === -1; }),
    };
  }

  function hold(held, name, text, notesText) {
    var next = {};
    Object.keys(held).forEach(function (k) { next[k] = held[k]; });
    next[name] = { text: text, notes: notesText };
    return next;
  }

  function recall(held, name, notesText) {
    var h = held[name];
    return h && h.notes === notesText ? h.text : null;
  }

  window.GoalPicks = { CAP: CAP, init: init, checked: checked, toggle: toggle, differs: differs, plan: plan, hold: hold, recall: recall };
})();
