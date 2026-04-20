import { pushParticle } from './moves-manager.js';
import { clampFloorAimToMaxRange } from './projectile-ground-hypot.js';
import { activeCrystalDrops } from '../main/play-crystal-drops.js';
import { tryPlayerCutHitWildCircle } from '../wild-pokemon/index.js';
import { tryDamagePlayerFromProjectile, player } from '../player.js';

const ABSORB_RADIUS = 3.2;

export function castAbsorbMove(sourceX, sourceY, targetX, targetY, sourceEntity, opts = {}) {
  const { fromWild = false, streamPuff = false, data } = opts;
  const maxR = 8;
  const { aimX, aimY } = clampFloorAimToMaxRange(sourceX, sourceY, targetX, targetY, maxR);
  
  if (!fromWild && streamPuff) {
    for (const d of activeCrystalDrops) {
      if (d.collecting) continue;
      const dx = aimX - d.x;
      const dy = aimY - d.y;
      if (dx * dx + dy * dy <= ABSORB_RADIUS * ABSORB_RADIUS) {
        d.collecting = true;
      }
    }
  }

  if (streamPuff) {
    const particles = 4;
    for (let i = 0; i < particles; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * ABSORB_RADIUS;
      const px = aimX + Math.cos(ang) * r;
      const py = aimY + Math.sin(ang) * r;
      pushParticle({
        type: 'absorbChargeParticle',
        x: px,
        y: py,
        vx: (sourceX - px) * 2.5,
        vy: (sourceY - py) * 2.5,
        z: 0.1,
        vz: 0,
        life: 0.4,
        maxLife: 0.4
      });
    }
  }

  if (data && streamPuff) {
    const dmg = fromWild ? 1.5 : 2.5;
    if (fromWild) {
       const px = player?.visualX ?? player?.x;
       const py = player?.visualY ?? player?.y;
       if (px != null && py != null) {
         const dist = Math.hypot(aimX - px, aimY - py);
         if (dist <= ABSORB_RADIUS) {
            tryDamagePlayerFromProjectile(dmg, false, data);
         }
       }
    } else {
       tryPlayerCutHitWildCircle(sourceEntity, data, aimX, aimY, ABSORB_RADIUS, {
         damage: dmg,
         knockback: 0,
         cutWildHitSound: false
       });
    }
  }
}
