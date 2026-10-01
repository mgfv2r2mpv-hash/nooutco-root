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
 * MASTER CAP. Six picks in all, skills and behavior reduction targets together.
 * A seventh check evicts the leftmost preselected chip still checked, and once
 * none is left, the oldest chip the technician checked.
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
    return {
      order: order,
      pre: inOrder(order, candidates.preselected || []),
      user: [],
    };
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
      var evictPre = inOrder(state.order, pre)[0];
      if (evictPre !== undefined) {
        pre = pre.filter(function (n) { return n !== evictPre; });
      } else {
        user = user.slice(1);
      }
    }
    return { order: state.order, pre: pre, user: user };
  }

  // The names a toggle unchecked besides the one the technician pressed, so the
  // thread can say what the cap took away.
  function evicted(before, after, toggled) {
    var now = checked(after);
    return checked(before).filter(function (n) { return n !== toggled && now.indexOf(n) === -1; });
  }

  // Put the chips back in line with the table for the named goals: checked when
  // their row is in the table, unchecked when it is not. Used when a swap fails
  // or a reply carries no row. A recheck never goes past the cap.
  function sync(state, gridNames, names) {
    var next = state;
    names.forEach(function (n) {
      var on = checked(next).indexOf(n) !== -1;
      var inGrid = gridNames.indexOf(n) !== -1;
      if (on && !inGrid) next = toggle(next, n);
      if (!on && inGrid && checked(next).length < CAP) next = toggle(next, n);
    });
    return next;
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

  // Fit a grid to the master cap of six rows. Free (reduction) rows have first
  // claim on the six, in grid order; the others fill what is left, in grid
  // order. What does not fit is returned, never lost in silence.
  function capRows(rows, isFree) {
    var free = 0;
    rows.forEach(function (r) { if (isFree(r)) free += 1; });
    var freeRoom = Math.min(free, CAP);
    var otherRoom = CAP - freeRoom;
    var freeSeen = 0;
    var otherSeen = 0;
    var kept = [];
    var dropped = [];
    rows.forEach(function (r) {
      if (isFree(r)) {
        freeSeen += 1;
        if (freeSeen <= freeRoom) kept.push(r); else dropped.push(r);
      } else {
        otherSeen += 1;
        if (otherSeen <= otherRoom) kept.push(r); else dropped.push(r);
      }
    });
    return { rows: kept, dropped: dropped };
  }

  window.GoalPicks = { CAP: CAP, capRows: capRows, init: init, checked: checked, toggle: toggle, evicted: evicted, sync: sync, differs: differs, plan: plan, hold: hold, recall: recall };
})();
