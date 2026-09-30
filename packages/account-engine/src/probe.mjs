// A fixed CPace run that any runtime can execute and report as plain JSON, so
// a test can check that Node, a browser and a Worker load the same engine and
// get the same answer. The code and channel are test values, not secrets.
import { generatorFor, initiatorStart, responderReply, initiatorFinish, responderConfirm } from './pake.mjs';
import { bytesToHex } from '../vendor/noble/hashes/utils.js';

const CHANNEL = 'horae-zone-probe|example.test';
const SID = new Uint8Array(16).fill(9);

function exchange(deviceCode, serviceCodes) {
  const a = initiatorStart({ code: deviceCode, channel: CHANNEL });
  const b = responderReply({ codes: serviceCodes, channel: CHANNEL, ...a.message });
  const finished = initiatorFinish(a.state, b.replies);
  const keys = finished ? responderConfirm(b.pending, finished.tagA) : null;
  return Boolean(finished && keys && bytesToHex(finished.keys.c2s) === bytesToHex(keys.c2s));
}

export function probe() {
  const generator = bytesToHex(generatorFor({ code: '482913', channel: CHANNEL, sid: SID }).toBytes());
  return {
    generator,
    finished: exchange('482913', ['482913', '000000']),
    wrongRefused: !exchange('111111', ['482913', '000000']),
  };
}
