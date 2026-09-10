/**
 * The campaign armoury host. This is render-side but Phaser-free at runtime
 * (Phaser is a type-only import), and it hid a bug for a day: it took a hull
 * class id while every caller handed it the commander id from the campaign
 * setup, so the armoury threw on open. Pinned here so that cannot come back.
 */
import { describe, expect, it } from 'vitest';
import { campaignHost } from '../src/render/shopHost';
import { COMMANDERS, commanderById } from '../src/core/campaign/commanders';

describe('campaignHost', () => {
  it('accepts a commander id and puts that commander’s hull under the loadout', () => {
    for (const c of COMMANDERS) {
      const host = campaignHost(c.id);
      expect(host.shoppers).toHaveLength(1);
      expect(host.shoppers[0].cls.id).toBe(commanderById(c.id).cls);
    }
  });

  it('shops the Advanced armoury, since the campaign runs on Advanced rules', () => {
    expect(campaignHost('rook').modeId).toBe('advanced');
  });

  it('starts from an empty loadout when nothing is stored', () => {
    // No localStorage under vitest: loadLoadout() has to fall back cleanly.
    const t = campaignHost('grimm').shoppers[0];
    expect(t.credits).toBe(0);
    expect(t.reinforcedHp).toBe(0);
    expect([...t.ammo.keys()]).toEqual([]);
  });

  it('spends and reinforces on the scratch tank like the match shop does', () => {
    const host = campaignHost('sable');
    const t = host.shoppers[0];
    t.credits = 2000;
    expect(host.buy(t, 'heavy')).toBe(true);
    expect(t.ammo.get('heavy')).toBe(5);
    expect(host.upgradeHull(t)).toBe(true);
    expect(t.reinforcedHp).toBe(10);
    expect(t.credits).toBe(2000 - 900 - 100);
  });
});
