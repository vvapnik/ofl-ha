// Simulates a real Head Device's mDNS self-advertisement — see
// open-farm-link/docs/16-rest-api.md §16.4. On startup, probes
// ofl-peer1.local, ofl-peer2.local, ... in order and claims the first one
// nothing on the network answers for, then publishes the _ofl._tcp.local.
// service under that hostname. The TXT record carries `garden_id`, plus
// `pair=button` / `pair=code` while the device accepts pairing
// (docs/22-security.md §22.4) — bonjour-service can't update TXT in place,
// so a change re-publishes the service under the same claimed hostname.
//
// "And on any hostname conflict thereafter" (§16.4): the device keeps
// listening, and if another host answers for the claimed name, it backs
// off for a random moment (so two racing devices don't collide again) and
// probes from 1 again. A conflict is recognized by the answer's address
// not being one of this machine's, so two mock instances on the *same*
// machine only negotiate at startup.
//
// This is a real implementation of the naming scheme, not a mock of it —
// point another instance of this same mock server at the same LAN and it
// will correctly negotiate the next number up.

import os from "node:os";
import mdns from "multicast-dns";
import { Bonjour, type Service } from "bonjour-service";

const HOSTNAME_PREFIX = "ofl-peer";
const PROBE_TIMEOUT_MS = 800;
const CONFLICT_BACKOFF_MAX_MS = 1000;

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

async function findFreeHostname(): Promise<string> {
  for (let n = 1; ; n++) {
    const hostname = `${HOSTNAME_PREFIX}${n}.local`;
    if (!(await probeHostname(hostname))) return hostname;
  }
}

function localAddresses(): Set<string> {
  return new Set(
    Object.values(os.networkInterfaces())
      .flat()
      .map((i) => i?.address)
      .filter((a): a is string => !!a),
  );
}

export type OflTxt = { garden_id: string; pair?: "button" | "code" };

export interface Advertisement {
  readonly hostname: string;
  update(txt: OflTxt): void;
}

export async function advertiseHeadDevice(port: number, txt: OflTxt): Promise<Advertisement> {
  const bonjour = new Bonjour();
  let hostname = await findFreeHostname();
  let current: OflTxt = txt;
  let service: Service | undefined;
  let reclaiming = false;

  const publish = () => {
    service = bonjour.publish({
      name: `Open Farm Link Head Device (${hostname})`,
      type: "ofl",
      protocol: "tcp",
      port,
      host: hostname,
      txt: Object.fromEntries(Object.entries(current).filter(([, v]) => v !== undefined)),
    });
  };
  const unpublish = () => new Promise<void>((resolve) => (service ? service.stop(() => resolve()) : resolve()));

  publish();
  console.log(`Head Device advertising as ${hostname} (TXT ${JSON.stringify(current)})`);

  const watcher = mdns();
  watcher.on("response", (response: mdns.ResponsePacket) => {
    if (reclaiming) return;
    const mine = localAddresses();
    const conflict = response.answers.some((a) => a.type === "A" && a.name === hostname && !mine.has(String(a.data)));
    if (!conflict) return;
    reclaiming = true;
    console.warn(`[mdns] another host answers for ${hostname} — re-probing (§16.4)`);
    void (async () => {
      await unpublish();
      await new Promise((r) => setTimeout(r, Math.random() * CONFLICT_BACKOFF_MAX_MS));
      hostname = await findFreeHostname();
      publish();
      console.log(`[mdns] now advertising as ${hostname}`);
      reclaiming = false;
    })();
  });

  // Send the goodbye packets, then exit — a signal handler replaces Node's default exit.
  const shutdown = () => {
    watcher.destroy();
    setTimeout(() => process.exit(0), 1000).unref();
    void unpublish().then(() => {
      bonjour.destroy();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    get hostname() {
      return hostname;
    },
    update(next) {
      if (next.garden_id === current.garden_id && next.pair === current.pair) return;
      current = next;
      if (reclaiming) return; // the re-publish picks `current` up
      void unpublish().then(() => {
        publish();
        console.log(`[mdns] TXT now ${JSON.stringify(current)}`);
      });
    },
  };
}
