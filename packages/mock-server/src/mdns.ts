// Simulates a real Head Device's mDNS self-advertisement — see
// open-farm-link/docs/16-rest-api.md §16.4. On startup, probes
// ofl-peer1.local, ofl-peer2.local, ... in order and claims the first one
// nothing on the network answers for, then publishes the _ofl._tcp.local.
// service under that hostname. The TXT record carries `garden_id`, plus
// `pair=button` / `pair=code` while the device accepts pairing
// (docs/22-security.md §22.4) — bonjour-service can't update TXT in place,
// so a change re-publishes the service under the same claimed hostname.
//
// This is a real implementation of the naming scheme, not a mock of it —
// point another instance of this same mock server at the same LAN and it
// will correctly negotiate the next number up.

import mdns from "multicast-dns";
import { Bonjour } from "bonjour-service";

const HOSTNAME_PREFIX = "ofl-peer";
const PROBE_TIMEOUT_MS = 800;

function probeHostname(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = mdns();
    let settled = false;

    const onResponse = (response: mdns.ResponsePacket) => {
      const taken = response.answers.some((a) => a.type === "A" && a.name === hostname);
      if (taken && !settled) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }, PROBE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      client.removeListener("response", onResponse);
      client.destroy();
    }

    client.on("response", onResponse);
    client.query({ questions: [{ name: hostname, type: "A" }] });
  });
}

async function findFreeHostname(): Promise<{ hostname: string; n: number }> {
  for (let n = 1; ; n++) {
    const hostname = `${HOSTNAME_PREFIX}${n}.local`;
    const taken = await probeHostname(hostname);
    if (!taken) return { hostname, n };
  }
}

export type OflTxt = { garden_id: string; pair?: "button" | "code" };

export interface Advertisement {
  hostname: string;
  update(txt: OflTxt): void;
}

export async function advertiseHeadDevice(port: number, txt: OflTxt): Promise<Advertisement> {
  const { hostname, n } = await findFreeHostname();
  const bonjour = new Bonjour();
  let current: OflTxt = txt;

  const publish = () =>
    bonjour.publish({
      name: `Open Farm Link Head Device (${hostname})`,
      type: "ofl",
      protocol: "tcp",
      port,
      host: hostname,
      txt: Object.fromEntries(Object.entries(current).filter(([, v]) => v !== undefined)),
    });
  let service = publish();

  console.log(`Head Device advertising as ${hostname} (claimed ofl-peer${n}, TXT ${JSON.stringify(current)})`);

  process.on("SIGINT", () => service.stop(() => bonjour.destroy()));
  process.on("SIGTERM", () => service.stop(() => bonjour.destroy()));

  return {
    hostname,
    update(next) {
      if (next.garden_id === current.garden_id && next.pair === current.pair) return;
      current = next;
      service.stop(() => {
        service = publish();
        console.log(`[mdns] TXT now ${JSON.stringify(current)}`);
      });
    },
  };
}
