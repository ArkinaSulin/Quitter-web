// src/hooks/useSupabaseSync.ts
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Unit, Hex, UnitTemplate, SizeCategory, getOrganizationLevel, UnitEffect } from '@/types/gameProtocol';
import { parseWeapons } from '@/lib/weaponParser';
import { alphaLabel } from '@/lib/unitNaming';
import { normalizeLocalAssetUrl, raceIconFromName } from '@/lib/imageUrls';
import { getSetting } from '@/lib/settingsCache';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// --- Converters ---
/** Sanitize a units.effects jsonb array into UnitEffect[] (defensive parsing). */
function parseEffects(raw: any): UnitEffect[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: any) => ({
    key: String(e?.key ?? ''),
    zoneHex: e?.zoneHex ? { q: Number(e.zoneHex.q) || 0, r: Number(e.zoneHex.r) || 0, s: Number(e.zoneHex.s) || 0 } : undefined,
    name: e?.name || '',
    color: e?.color || '#cccccc',
    kind: e?.kind || 'ac',
    delta: Number(e?.delta) || 0,
    duration: Number(e?.duration) || 1,
    turnsLeft: Number(e?.turnsLeft) ?? 1,
    casterUnitId: e?.casterUnitId ?? null,
    casterTeam: e?.casterTeam ?? null,
    casterPlayerId: e?.casterPlayerId ?? null,
    base: e?.base == null ? undefined : Number(e.base),
  })).filter(e => e.key);
}

function mapRowToUnit(row: any): Unit {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    templateId: row.template_id || null,
    unitName: row.unit_name || '',
    raceId: row.race_id || '',
    raceName: row.race_name || '',
    armorName: row.armor_name || '',
    mountId: row.mount_id || null,
    mountName: row.mount_name || '',
    isHero: row.is_hero || false,
    attachedToUnitId: row.attached_to_unit_id || null,
    currentTroopCount: row.current_troop_count ?? 1,
    maxTroopCount: row.max_troop_count || 1,
    level: row.level || 1,
    troopHp: row.troop_hp || 1,
    maxUnitHp: row.max_unit_hp || 1,
    currentUnitHp: row.current_unit_hp || 0,
    isShielded: row.is_shielded || false,
    baselineAc: row.baseline_ac || 10,
    currentAc: row.current_ac || 10,
    weaponString: row.weapon_string || '',
    movementPoints: row.movement_points || 3,
    movementPointsAvailable: row.movement_points_available || 0,
    aggressiveness: row.aggressiveness || 3,
    baseMorale: row.base_morale || 3,
    currentMoraleModifier: row.current_morale_modifier || 0,
    sizeCategory: row.size_category || 100,
    visualScale: row.visual_scale || 100,
    currentFormation: row.current_formation || 'Scattered',
    organizationLevel: getOrganizationLevel(row.current_formation || 'Scattered'),
    formationAvailability: row.formation_availability || ['Scattered', 'Routed'],
    equipCostGp: row.equip_cost_gp || 0,
    raceIconUrl: raceIconFromName(row.race_name, row.race_icon_url),
    unitTypeIconUrl: normalizeLocalAssetUrl(row.unit_type_icon_url),
    customImageUrl: normalizeLocalAssetUrl(row.custom_image_url),
    canCharge: row.can_charge || false,
    darkvision: Number(row.darkvision) || 0,
    effects: parseEffects(row.effects),
    hex: { q: row.hex_q, r: row.hex_r, s: row.hex_s },
    facing: row.facing || 0,
    team: row.team || 'black',
    attachedPosition: row.attached_position || null,
    hidden: row.hidden || false,
    isDeleted: row.is_deleted || false,
    ignoreMoraleChecks: row.ignore_morale_checks || false,
    isCharging: row.is_charging || false,
    chargeDistance: row.charge_distance || 0,
    commandSeq: row.command_seq || 0,
    actionsAvailable: row.actions_available || 0,
    attacksUsed: row.attacks_used || 0,
    archerReactionUsed: row.archer_reaction_used || false,
    activeWeaponIndex: row.active_weapon_index || 0,
    str: row.str ?? 0,
    dex: row.dex ?? 0,
    con: row.con ?? 0,
    int: row.int ?? 0,
    wis: row.wis ?? 0,
    cha: row.cha ?? 0,
  };
}

function mapUnitToRow(unit: Unit, scenarioId: string = 'default_mvp') {
  return {
    id: unit.id,
    scenario_id: scenarioId,
    unit_name: unit.unitName,
    template_id: unit.templateId,
    race_id: unit.raceId || null,
    race_name: unit.raceName,
    armor_name: unit.armorName,
    mount_id: unit.mountId,
    mount_name: unit.mountName,
    is_hero: unit.isHero,
    attached_to_unit_id: unit.attachedToUnitId || null,
    ...(unit.attachedPosition ? { attached_position: unit.attachedPosition } : {}),
    current_troop_count: unit.currentTroopCount,
    max_troop_count: unit.maxTroopCount,
    level: unit.level,
    troop_hp: unit.troopHp ||1,
    max_unit_hp: unit.maxUnitHp || 1,
    current_unit_hp: unit.currentUnitHp,
    is_shielded: unit.isShielded,
    baseline_ac: unit.baselineAc,
    current_ac: unit.currentAc,
    weapon_string: unit.weaponString,
    movement_points: unit.movementPoints,
    movement_points_available: unit.movementPointsAvailable,
    aggressiveness: unit.aggressiveness,
    base_morale: unit.baseMorale,
    current_morale_modifier: unit.currentMoraleModifier,
    size_category: unit.sizeCategory,
    visual_scale: unit.visualScale,
    current_formation: unit.currentFormation,
    organization_level: unit.organizationLevel,
    formation_availability: unit.formationAvailability,
    equip_cost_gp: unit.equipCostGp,
    race_icon_url: unit.raceIconUrl || '',
    unit_type_icon_url: unit.unitTypeIconUrl || '',
    custom_image_url: unit.customImageUrl || '',
    can_charge: unit.canCharge || false,
    darkvision: unit.darkvision || 0,
    effects: unit.effects ?? [],
    hex_q: unit.hex.q,
    hex_r: unit.hex.r,
    hex_s: unit.hex.s,
    facing: unit.facing,
    team: unit.team,
    hidden: unit.hidden,
    is_deleted: unit.isDeleted,
    ignore_morale_checks: unit.ignoreMoraleChecks,
    is_charging: unit.isCharging || false,
    charge_distance: unit.chargeDistance || 0,
    actions_available: unit.actionsAvailable || 0,
    attacks_used: unit.attacksUsed || 0,
    archer_reaction_used: unit.archerReactionUsed || false,
    active_weapon_index: unit.activeWeaponIndex || 0,
    str: unit.str ?? 0,
    dex: unit.dex ?? 0,
    con: unit.con ?? 0,
    int: unit.int ?? 0,
    wis: unit.wis ?? 0,
    cha: unit.cha ?? 0,
  };
}

// --- Singleton channel manager ---
const channelMap = new Map<string, any>();
const listenerMap = new Map<string, Array<(payload: any) => void>>();

function getOrCreateChannel(scenarioId: string) {
  if (!channelMap.has(scenarioId)) {
    console.log(`[Realtime] Creating singleton channel for ${scenarioId}`);
    const channel = supabase
      .channel(`units:${scenarioId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'units',
          filter: `scenario_id=eq.${scenarioId}`,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const listeners = listenerMap.get(scenarioId) || [];
          for (const listener of listeners) {
            listener(payload);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Singleton channel ${scenarioId} status:`, status);
      });
    channelMap.set(scenarioId, channel);
  }
  return channelMap.get(scenarioId);
}

function addListener(scenarioId: string, callback: (payload: any) => void) {
  if (!listenerMap.has(scenarioId)) {
    listenerMap.set(scenarioId, []);
  }
  listenerMap.get(scenarioId)!.push(callback);
}

function removeListener(scenarioId: string, callback: (payload: any) => void) {
  const listeners = listenerMap.get(scenarioId);
  if (listeners) {
    const index = listeners.indexOf(callback);
    if (index !== -1) listeners.splice(index, 1);
  }
}

export function useSupabaseSync(scenarioId: string = 'default_mvp') {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sizeCategories, setSizeCategories] = useState<SizeCategory[]>([]);
  const callbackRef = useRef<(payload: any) => void>();
  const unitsRef = useRef(units);
  unitsRef.current = units;

  // 1. Load units on mount
  useEffect(() => {
    let isMounted = true;

    const fetchInitial = async () => {
      try {
        const [unitsRes, sizeCatRes] = await Promise.all([
          supabase.from('units').select('*').eq('scenario_id', scenarioId),
          supabase.from('size_categories').select('*'),
        ]);

        if (unitsRes.error) throw unitsRes.error;
        if (sizeCatRes.error) throw sizeCatRes.error;

        if (isMounted) {
          if (unitsRes.data) {
            const mapped = unitsRes.data.map(mapRowToUnit);
            setUnits(mapped);
          }
          if (sizeCatRes.data) setSizeCategories(sizeCatRes.data);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('[Supabase] Fetch error:', err);
        if (isMounted) setError(err.message || 'Failed to load initial data');
      }
    };

    fetchInitial();

    return () => { isMounted = false; };
  }, [scenarioId]);

  // 2. Realtime subscription
  useEffect(() => {
    getOrCreateChannel(scenarioId);

    const handleRealtime = (payload: RealtimePostgresChangesPayload<any>) => {
      console.log('[Realtime] Payload received:', payload);
      setUnits((prevUnits) => {
        const { eventType, new: newRow, old: oldRow } = payload;

        if (eventType === 'INSERT' && newRow) {
          const newUnit = mapRowToUnit(newRow);
          if (prevUnits.some(u => u.id === newUnit.id)) {
            return prevUnits.map(u => u.id === newUnit.id ? newUnit : u);
          }
          return [...prevUnits, newUnit];
        }

        if (eventType === 'UPDATE' && newRow) {
          const updatedUnit = mapRowToUnit(newRow);
          return prevUnits.map(u => {
            if (u.id !== updatedUnit.id) return u;
            // Drop stale events: every command write stamps command_seq (the
            // monotonic command_log seq). A realtime event whose stamp is not
            // strictly newer than the local one reflects an older write — e.g. the
            // ATTACK row from a charge reaching the client after the CHARGE_END —
            // so applying it would regress state (the formation flicker bug).
            const incoming = newRow.command_seq ?? 0;
            if (incoming <= u.commandSeq) return u;
            // Preserve attachedPosition from local state if DB has null (migration may not be applied yet)
            if (u.attachedPosition && !updatedUnit.attachedPosition) {
              return { ...updatedUnit, attachedPosition: u.attachedPosition };
            }
            return updatedUnit;
          });
        }

        if (eventType === 'DELETE' && oldRow) {
          return prevUnits.filter(u => u.id !== oldRow.id);
        }

        return prevUnits;
      });
    };

    addListener(scenarioId, handleRealtime);
    callbackRef.current = handleRealtime;

    return () => {
      if (callbackRef.current) {
        removeListener(scenarioId, callbackRef.current);
      }
    };
  }, [scenarioId]);

  // 3. Apply unit updates to LOCAL state only (no DB write).
  //    The command engine (execute/undo/redo) writes the DB via server RPCs; this
  //    just paints the optimistic result on screen. Realtime confirms.
  const applyLocalUnit = useCallback((unitId: string, updates: Partial<Unit>) => {
    setUnits(prev =>
      prev.map(u => (u.id === unitId ? { ...u, ...updates } : u))
    );
  }, []);

  // Authoritative refetch: replace the given units with their DB rows. Used after
  // undo/redo so local state can never diverge from the server — a stale local
  // snapshot (e.g. a hero still marked attached after an undo's optimistic paint)
  // would otherwise corrupt the NEXT command computed from it.
  const refreshUnitsByIds = useCallback(async (ids: string[]): Promise<void> => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .in('id', unique);
    if (error) {
      console.error('[refreshUnitsByIds] Failed:', error);
      return;
    }
    const rows = new Map((data ?? []).map((r: any) => [r.id, mapRowToUnit(r)]));
    setUnits(prev => prev.map(u => (rows.has(u.id) ? rows.get(u.id)! : u)));
  }, [scenarioId]);

  // 4. Clear units
  const clearUnits = useCallback(async () => {
    const { error } = await supabase
      .from('units')
      .delete()
      .eq('scenario_id', scenarioId);
    if (error) console.error('Clear units error:', error);
  }, [scenarioId]);

  // 5. Add unit from template
  const addUnitFromTemplate = useCallback(async (template: UnitTemplate, hex: Hex, team: string = 'black'): Promise<Unit | null> => {
    let defaultFormation = 'Scattered';
    if (template.formationAvailability && template.formationAvailability.includes('Open Order')) {
      defaultFormation = 'Open Order';
    }

    // Safety: ensure HP is never null/undefined
    const troopHp = template.troopHp ?? 1;
    const sc = sizeCategories.find(s => s.size_category === (template.sizeCategory || 100));
    const scSize = template.sizeCategory || 100;
    const scFallback = scSize >= 400 ? 1 : scSize >= 300 ? 6 : scSize >= 200 ? 20 : template.mountId ? 40 : 80;
    const maxTroops = sc ? (template.mountId ? sc.max_troops_mounted : sc.max_troops) : scFallback;
    const troopCount = Math.min(template.troopCount ?? 1, maxTroops);
    const maxUnitHpValue = template.maxUnitHp ?? (troopHp * troopCount);
    const currentUnitHpValue = maxUnitHpValue;

    // Calculate canCharge from race or mount
    let canCharge = template.canCharge || false;
    if (template.raceCanCharge) canCharge = true;
    if (template.mountCanCharge) canCharge = true;

    // Placement check: a shield cannot be used while wielding a two-handed weapon.
    // The active weapon at placement is the first in the string (index 0), so a
    // shielded unit holding a two-handed weapon spawns at AC baseline - 2.
    const activeWeaponIndex = 0;
    const spawnWeapons = parseWeapons(template.weaponString || '');
    const shieldDroppedAtSpawn = template.isShielded && (spawnWeapons[activeWeaponIndex]?.isTwoHanded || false);

    // Universal scenario serial: the first unit ever placed is A, then B, ...
    // regardless of template / team / alliance, so "Human Soldier A" and
    // "Human Guard A" can never collide. Soft-deleted units stay in state, so
    // the count is monotonic and serials are never reused.
    const instanceNumber = unitsRef.current.length + 1;

    const newUnit: Unit = {
      id: crypto.randomUUID(),
      scenarioId: scenarioId,
      templateId: template.id,
      unitName: `${template.unitName} ${alphaLabel(instanceNumber)}`,
      raceId: template.raceId || '',
      raceName: template.raceName || '',
      armorName: template.armorName || '',
      mountId: template.mountId || null,
      mountName: template.mountName || '',
      isHero: template.isHero || false,
      attachedToUnitId: null,
      attachedPosition: null,
      currentTroopCount: troopCount,
      maxTroopCount: troopCount,
      level: template.level || 1,
      troopHp: troopHp,
      maxUnitHp: maxUnitHpValue,
      currentUnitHp: currentUnitHpValue,
      isShielded: template.isShielded || false,
      baselineAc: template.baselineAc || 10,
      currentAc: shieldDroppedAtSpawn ? (template.baselineAc || 10) - 2 : (template.baselineAc || 10),
      weaponString: template.weaponString || '',
      movementPoints: template.movementPoints || 3,
      // Units spawn at 0 MP (actions materialize pools); heroes spawn with FULL MP
      // (their whole movement up front) + their full action count.
      movementPointsAvailable: template.isHero
        ? (template.movementPoints || 3)
        : getSetting('turn_start_mp', 0),
      aggressiveness: template.aggressiveness || 3,
      baseMorale: template.baseMorale || 3,
      currentMoraleModifier: 0,
      sizeCategory: template.sizeCategory || 100,
      visualScale: template.visualScale || 100,
      currentFormation: template.isHero ? 'Hero' : defaultFormation,
      organizationLevel: getOrganizationLevel(template.isHero ? 'Hero' : defaultFormation),
      formationAvailability: template.isHero ? ['Hero'] : (template.formationAvailability || ['Scattered', 'Routed']),
      equipCostGp: template.equipCostGp || 0,
      raceIconUrl: raceIconFromName(template.raceName, template.raceIconUrl),
      unitTypeIconUrl: normalizeLocalAssetUrl(template.unitTypeIconUrl),
      customImageUrl: normalizeLocalAssetUrl(template.customImageUrl),
      canCharge: canCharge,
      darkvision: template.darkvision || 0,
      effects: [],
      hex: hex,
      facing: 0,
      team: team,
      hidden: false,
      isDeleted: false,
      ignoreMoraleChecks: template.ignoreMoraleChecks || false,
      isCharging: false,
      chargeDistance: 0,
      commandSeq: 0,
      actionsAvailable: template.isHero
        ? getSetting('hero_actions_per_turn', 5)
        : getSetting('actions_per_turn', 2),
      attacksUsed: 0,
      archerReactionUsed: false,
      activeWeaponIndex,
      str: template.str ?? 0,
      dex: template.dex ?? 0,
      con: template.con ?? 0,
      int: template.int ?? 0,
      wis: template.wis ?? 0,
      cha: template.cha ?? 0,
    };

    const row = mapUnitToRow(newUnit, scenarioId);
    const { error } = await supabase
      .from('units')
      .insert(row);

    if (error) {
      console.error('[DEBUG-b7e3] Insert failed:', error.message, 'details:', error.details, 'hint:', error.hint, 'row:', JSON.stringify(row));
      return null;
    }

    setUnits(prev => [...prev, newUnit]);
    return newUnit;
  }, [scenarioId, sizeCategories]);

  // 6. Delete a single unit
  const deleteUnit = useCallback(async (unitId: string) => {
    const { error } = await supabase
      .from('units')
      .delete()
      .eq('id', unitId)
      .eq('scenario_id', scenarioId);
    if (error) {
      console.error('[deleteUnit] Failed:', error);
      return false;
    }
    setUnits(prev => prev.filter(u => u.id !== unitId));
    return true;
  }, [scenarioId]);

  return {
    units,
    setUnits,
    applyLocalUnit,
    refreshUnitsByIds,
    loading,
    error,
    clearUnits,
    addUnitFromTemplate,
    deleteUnit,
    sizeCategories,
  };
}