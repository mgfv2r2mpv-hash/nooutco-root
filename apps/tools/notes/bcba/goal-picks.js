/* Goal picker rules for the supervision tool.
 *
 * WHAT THIS IS. The picker's logic with no DOM and no model call: which chips
 * are checked, the cap of six, which chip a seventh check evicts, whether the
 * picks differ from the grid, and the last text of a row that was dropped.
 *
 * STATE. { order, pre, user, free }. `order` is the strip order of every candidate
 * name. `pre` is the preselected names still checked. `user` is the names the
 * technician checked, oldest first. Every function returns a new state.
 *
 * CAP. Six picked skills. A seventh skill check evicts the leftmost preselected
 * skill chip still checked, and once none is left, the oldest skill chip the
 * technician checked. `free` names the reduction targets: they sit on top of the
 * six, never count toward it and are never evicted.
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
      free: (candidates.free || []).slice(),
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
        free: state.free,
      };
    }
    var pre = state.pre;
    var user = state.user.concat([name]);
    var skill = function (n) { return state.free.indexOf(n) === -1; };
    if (pre.filter(skill).length + user.filter(skill).length > CAP) {
      var evictPre = pre.filter(skill)[0];
      if (evictPre !== undefined) {
        pre = pre.filter(function (n) { return n !== evictPre; });
      } else {
        var evictUser = user.filter(skill)[0];
        user = user.filter(function (n) { return n !== evictUser; });
      }
    }
    return { order: state.order, pre: pre, user: user, free: state.free };
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

  // Fit a grid to the cap: every free (reduction) row stays, and the first CAP
  // others stay in order. What does not fit is returned, never lost in silence.
  function capRows(rows, isFree) {
    var kept = [];
    var dropped = [];
    var skills = 0;
    rows.forEach(function (r) {
      if (isFree(r)) { kept.push(r); return; }
      if (skills < CAP) { skills += 1; kept.push(r); } else dropped.push(r);
    });
    return { rows: kept, dropped: dropped };
  }

  window.GoalPicks = { CAP: CAP, capRows: capRows, init: init, checked: checked, toggle: toggle, differs: differs, plan: plan, hold: hold, recall: recall };
})();
