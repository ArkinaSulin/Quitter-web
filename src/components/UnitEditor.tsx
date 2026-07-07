// src/components/UnitEditor.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { UnitTemplate, Race, Armor, Formation, ModelType, Mount } from '@/types/gameProtocol';
import { parseWeapons, stringifyWeapons, Weapon as WeaponType } from '@/lib/weaponParser';

// Helper to map DB snake_case to camelCase
function mapTemplate(row: any): UnitTemplate {
  return {
    id: row.id,
    name: row.name,
    raceId: row.race_id,
    raceName: row.races?.name,
    modelTypeId: row.model_type_id,
    modelTypeName: row.model_types?.name,
    isHero: row.is_hero,
    isPlayerHero: row.is_player_hero,
    bodyCount: row.body_count,
    level: row.level,
    hp: row.hp,
    armorId: row.armor_id,
    armorName: row.armors?.name,
    isShielded: row.is_shielded,
    baseAc: row.base_ac,
    weaponString: row.weapon_string || '',
    mountId: row.mount_id,
    mountName: row.mounts?.name,
    movementPoints: row.movement_points,
    aggressiveness: row.aggressiveness || 3,
    baseMorale: row.base_morale || 3,
    troopScale: row.troop_scale,
    formationAvailability: row.formation_availability || [],
    costGp: row.cost_gp || 0,
    acSpecialModifier: row.ac_special_modifier || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplateToRow(template: UnitTemplate) {
  return {
    id: template.id,
    name: template.name,
    race_id: template.raceId,
    model_type_id: template.modelTypeId,
    is_hero: template.isHero,
    is_player_hero: template.isPlayerHero,
    body_count: template.bodyCount,
    level: template.level,
    hp: template.hp,
    armor_id: template.armorId,
    is_shielded: template.isShielded,
    base_ac: template.baseAc,
    weapon_string: template.weaponString || '',
    mount_id: template.mountId,
    movement_points: template.movementPoints,
    aggressiveness: template.aggressiveness || 3,
    base_morale: template.baseMorale || 3,
    troop_scale: template.troopScale,
    formation_availability: template.formationAvailability || [],
    cost_gp: template.costGp || 0,
    ac_special_modifier: template.acSpecialModifier || '',
    updated_at: new Date().toISOString(),
  };
}

function isValidDamageDice(dice: string): boolean {
  const pattern = /^(\d+d\d+)([+-]\d+)?(\+\d+d\d+)*([+-]\d+)?$/;
  return pattern.test(dice.trim());
}

export default function UnitEditor() {
  const router = useRouter();
  const [templates, setTemplates] = useState<UnitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lookup data
  const [races, setRaces] = useState<Race[]>([]);
  const [weaponsLookup, setWeaponsLookup] = useState<{ id: string; name: string; damage_dice: string; special: string | null; cost_gp: number }[]>([]);
  const [armors, setArmors] = useState<Armor[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [modelTypes, setModelTypes] = useState<ModelType[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);

  // Current unit being edited
  const [unit, setUnit] = useState<UnitTemplate | null>(null);

  // Weapon editor state
  const [showWeaponModal, setShowWeaponModal] = useState(false);
  const [editingWeaponIndex, setEditingWeaponIndex] = useState<number | null>(null);
  const [weaponName, setWeaponName] = useState('');
  const [weaponTargetType, setWeaponTargetType] = useState<'single' | 'area'>('single');
  const [weaponDamageDice, setWeaponDamageDice] = useState('1d6');
  const [weaponRange, setWeaponRange] = useState(1);
  const [weaponError, setWeaponError] = useState('');
  const [weaponSearchTerm, setWeaponSearchTerm] = useState('');
  const [showWeaponSuggestions, setShowWeaponSuggestions] = useState(false);

  // Clone modal state
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  // --- COMPUTED VALUES (as functions, not hooks) ---
  const getWeapons = (): WeaponType[] => {
    if (!unit) return [];
    return parseWeapons(unit.weaponString);
  };

  const getWeaponCost = (weaponName: string): number => {
    const found = weaponsLookup.find(w => w.name === weaponName);
    return found?.cost_gp || 0;
  };

  const getCurrentAC = () => {
    if (!unit) return 10;
    const selectedRace = races.find(r => r.id === unit.raceId);
    const selectedArmor = armors.find(a => a.id === unit.armorId);
    let ac = unit.baseAc + (selectedArmor?.acBonus || 0) + (unit.isShielded ? 2 : 0) + (selectedRace?.acBonus || 0);
    const specialBonus = parseInt(unit.acSpecialModifier) || 0;
    ac += specialBonus;
    return Math.max(0, Math.min(30, ac));
  };

  const getCurrentMovement = () => {
    if (!unit) return 3;
    const selectedRace = races.find(r => r.id === unit.raceId);
    const selectedArmor = armors.find(a => a.id === unit.armorId);
    const selectedMount = mounts.find(m => m.id === unit.mountId);
    const raceSpeed = selectedRace?.baseSpeed || 3;
    const mountSpeed = selectedMount?.speed || 0;
    const movement = Math.max(raceSpeed, mountSpeed) - (selectedArmor?.movementPenalty || 0);
    return Math.max(1, movement);
  };

  const getCurrentCost = () => {
    if (!unit) return 0;
    const selectedArmor = armors.find(a => a.id === unit.armorId);
    const selectedMount = mounts.find(m => m.id === unit.mountId);
    let cost = 0;
    const weapons = getWeapons();
    for (const w of weapons) cost += getWeaponCost(w.name);
    if (selectedArmor) cost += selectedArmor.costGp;
    if (unit.isShielded) cost += 10;
    if (selectedMount) cost += selectedMount.costGp;
    return cost;
  };

  // --- Fetch data ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: templateData, error: templateError } = await supabase
          .from('unit_templates')
          .select(`
            *,
            races(name),
            model_types(name),
            armors(name),
            mounts(name)
          `)
          .order('name');

        if (templateError) throw templateError;
        setTemplates((templateData || []).map(mapTemplate));

        const [
          racesRes,
          weaponsRes,
          armorsRes,
          formationsRes,
          modelTypesRes,
          mountsRes,
        ] = await Promise.all([
          supabase.from('races').select('*').order('name'),
          supabase.from('weapons').select('*').order('name'),
          supabase.from('armors').select('*').order('name'),
          supabase.from('formations').select('*').order('name'),
          supabase.from('model_types').select('*').order('name'),
          supabase.from('mounts').select('*').order('name'),
        ]);

        if (racesRes.error) throw racesRes.error;
        if (weaponsRes.error) throw weaponsRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (formationsRes.error) throw formationsRes.error;
        if (modelTypesRes.error) throw modelTypesRes.error;
        if (mountsRes.error) throw mountsRes.error;

        setRaces(racesRes.data || []);
        setWeaponsLookup(weaponsRes.data || []);
        setArmors(armorsRes.data || []);
        setFormations(formationsRes.data || []);
        setModelTypes(modelTypesRes.data || []);
        setMounts(mountsRes.data || []);

        setLoading(false);
      } catch (err: any) {
        console.error('Fetch error:', err);
        setError(err.message || 'Failed to load data');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Select a template
  useEffect(() => {
    if (selectedId) {
      const found = templates.find(t => t.id === selectedId);
      setUnit(found ? { ...found } : null);
    } else {
      setUnit(null);
    }
  }, [selectedId, templates]);

  // --- Auto-calculate derived values ---
  const calculateDerivedValues = useCallback(() => {
    if (!unit) return;

    const selectedRace = races.find(r => r.id === unit.raceId);
    const selectedArmor = armors.find(a => a.id === unit.armorId);
    const selectedMount = mounts.find(m => m.id === unit.mountId);

    let ac = unit.baseAc + (selectedArmor?.acBonus || 0) + (unit.isShielded ? 2 : 0) + (selectedRace?.acBonus || 0);
    const specialBonus = parseInt(unit.acSpecialModifier) || 0;
    ac += specialBonus;
    ac = Math.max(0, Math.min(30, ac));

    const raceSpeed = selectedRace?.baseSpeed || 3;
    const mountSpeed = selectedMount?.speed || 0;
    const movement = Math.max(raceSpeed, mountSpeed) - (selectedArmor?.movementPenalty || 0);
    const finalMovement = Math.max(1, movement);

    let cost = 0;
    const weapons = getWeapons();
    for (const w of weapons) {
      cost += getWeaponCost(w.name);
    }
    if (selectedArmor) cost += selectedArmor.costGp;
    if (unit.isShielded) cost += 10;
    if (selectedMount) cost += selectedMount.costGp;

    const updatedUnit = {
      ...unit,
      ac: ac,
      movementPoints: finalMovement,
      costGp: cost,
    };
    setUnit(updatedUnit);
  }, [unit, races, armors, mounts, weaponsLookup]);

  // Recalculate whenever dependencies change
  useEffect(() => {
    if (unit) {
      calculateDerivedValues();
    }
  }, [
    unit?.baseAc,
    unit?.armorId,
    unit?.isShielded,
    unit?.raceId,
    unit?.mountId,
    unit?.acSpecialModifier,
    unit?.weaponString,
    unit?.baseMorale,
  ]);

  // --- Weapon Editor Functions ---
  const openAddWeapon = () => {
    setEditingWeaponIndex(null);
    setWeaponName('');
    setWeaponSearchTerm('');
    setWeaponTargetType('single');
    setWeaponDamageDice('1d6');
    setWeaponRange(1);
    setWeaponError('');
    setShowWeaponSuggestions(false);
    setShowWeaponModal(true);
  };

  const openEditWeapon = (index: number) => {
    const weapons = getWeapons();
    const w = weapons[index];
    if (!w) return;
    setEditingWeaponIndex(index);
    setWeaponName(w.name);
    setWeaponSearchTerm(w.name);
    setWeaponTargetType(w.targetType);
    setWeaponDamageDice(w.damageDice);
    setWeaponRange(w.range);
    setWeaponError('');
    setShowWeaponSuggestions(false);
    setShowWeaponModal(true);
  };

  const selectWeaponFromLookup = (weapon: { name: string; damage_dice: string; special: string | null }) => {
    setWeaponName(weapon.name);
    setWeaponSearchTerm(weapon.name);
    setWeaponDamageDice(weapon.damage_dice);
    if (weapon.special?.includes('Range')) {
      setWeaponTargetType('single');
      setWeaponRange(6);
    } else if (weapon.name.toLowerCase().includes('fireball') || weapon.name.toLowerCase().includes('area')) {
      setWeaponTargetType('area');
      setWeaponRange(4);
    } else {
      setWeaponTargetType('single');
      setWeaponRange(1);
    }
    setShowWeaponSuggestions(false);
  };

  const getWeaponSuggestions = () => {
    if (!weaponSearchTerm.trim()) return [];
    const term = weaponSearchTerm.toLowerCase();
    return weaponsLookup
      .filter(w => w.name.toLowerCase().includes(term))
      .slice(0, 5);
  };

  const saveWeapon = () => {
    if (!unit) return;
    if (!weaponName.trim()) {
      setWeaponError('Weapon name is required');
      return;
    }
    if (!isValidDamageDice(weaponDamageDice)) {
      setWeaponError('Damage dice must be in format like "1d6", "2d6+2", or "1d4+2d6"');
      return;
    }
    if (weaponRange < 1) {
      setWeaponError('Range must be at least 1 (adjacent)');
      return;
    }

    const currentWeapons = getWeapons();
    const newWeapon: WeaponType = {
      name: weaponName.trim(),
      targetType: weaponTargetType,
      damageDice: weaponDamageDice.trim(),
      range: weaponRange,
    };

    let updatedWeapons: WeaponType[];
    if (editingWeaponIndex !== null) {
      updatedWeapons = [...currentWeapons];
      updatedWeapons[editingWeaponIndex] = newWeapon;
    } else {
      updatedWeapons = [...currentWeapons, newWeapon];
    }

    const weaponString = stringifyWeapons(updatedWeapons);
    updateUnit('weaponString', weaponString);
    setShowWeaponModal(false);
    setWeaponError('');
  };

  const removeWeapon = (index: number) => {
    if (!unit) return;
    const currentWeapons = getWeapons();
    const updatedWeapons = currentWeapons.filter((_, i) => i !== index);
    const weaponString = stringifyWeapons(updatedWeapons);
    updateUnit('weaponString', weaponString);
  };

  // --- Unit CRUD ---
  const createBlankTemplate = (): UnitTemplate => {
    return {
      id: crypto.randomUUID(),
      name: 'New Unit',
      raceId: races[0]?.id || '',
      raceName: races[0]?.name || '',
      modelTypeId: modelTypes[0]?.id || '',
      modelTypeName: modelTypes[0]?.name || '',
      isHero: false,
      isPlayerHero: false,
      bodyCount: 1,
      level: 1,
      hp: 10,
      armorId: armors[0]?.id || '',
      armorName: armors[0]?.name || '',
      isShielded: false,
      baseAc: 10,
      weaponString: '',
      mountId: mounts[0]?.id || '',
      mountName: mounts[0]?.name || '',
      movementPoints: 3,
      aggressiveness: 3,
      baseMorale: 3,
      troopScale: 100,
      formationAvailability: ['Scattered'],
      costGp: 0,
      acSpecialModifier: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleNew = () => {
    const blank = createBlankTemplate();
    setTemplates(prev => [...prev, blank]);
    setSelectedId(blank.id);
  };

  const handleClone = () => {
    if (!unit) return;
    setCloneName(`${unit.name} (Clone)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const confirmClone = async () => {
    if (!unit) return;
    if (!cloneName.trim()) {
      setCloneError('Name is required');
      return;
    }
    if (templates.some(t => t.name === cloneName.trim())) {
      setCloneError('A unit with this name already exists');
      return;
    }
    try {
      const newUnit: UnitTemplate = {
        ...unit,
        id: crypto.randomUUID(),
        name: cloneName.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('unit_templates')
        .insert(mapTemplateToRow(newUnit))
        .select()
        .single();
      if (error) throw error;
      const mapped = mapTemplate(data);
      setTemplates(prev => [...prev, mapped]);
      setSelectedId(mapped.id);
      setShowCloneModal(false);
      setCloneName('');
    } catch (err: any) {
      setCloneError(err.message || 'Failed to clone unit');
    }
  };

  const handleSave = async () => {
    if (!unit) return;
    if (!unit.name.trim()) {
      setError('Unit name is required');
      return;
    }
    const duplicate = templates.find(t => t.name === unit.name.trim() && t.id !== unit.id);
    if (duplicate) {
      setError('A unit with this name already exists');
      return;
    }
    const weapons = getWeapons();
    if (weapons.length === 0) {
      if (!confirm('This unit has no weapons! Are you sure you want to save it?')) {
        return;
      }
    }

    try {
      const selectedRace = races.find(r => r.id === unit.raceId);
      const selectedArmor = armors.find(a => a.id === unit.armorId);
      const selectedMount = mounts.find(m => m.id === unit.mountId);

      let ac = unit.baseAc + (selectedArmor?.acBonus || 0) + (unit.isShielded ? 2 : 0) + (selectedRace?.acBonus || 0);
      const specialBonus = parseInt(unit.acSpecialModifier) || 0;
      ac += specialBonus;
      ac = Math.max(0, Math.min(30, ac));

      const raceSpeed = selectedRace?.baseSpeed || 3;
      const mountSpeed = selectedMount?.speed || 0;
      const movement = Math.max(raceSpeed, mountSpeed) - (selectedArmor?.movementPenalty || 0);
      const finalMovement = Math.max(1, movement);

      let cost = 0;
      const parsedWeapons = getWeapons();
      for (const w of parsedWeapons) {
        cost += getWeaponCost(w.name);
      }
      if (selectedArmor) cost += selectedArmor.costGp;
      if (unit.isShielded) cost += 10;
      if (selectedMount) cost += selectedMount.costGp;

      const updatedUnit = {
        ...unit,
        ac: ac,
        movementPoints: finalMovement,
        costGp: cost,
        updatedAt: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('unit_templates')
        .update(mapTemplateToRow(updatedUnit))
        .eq('id', unit.id)
        .select()
        .single();
      if (error) throw error;
      const mapped = mapTemplate(data);
      setTemplates(prev => prev.map(t => t.id === mapped.id ? mapped : t));
      setUnit(mapped);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save unit');
    }
  };

  const handleSaveAs = () => {
    if (!unit) return;
    setCloneName(`${unit.name} (Copy)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const handleDelete = async () => {
    if (!unit) return;
    if (!confirm(`Delete unit "${unit.name}"?`)) return;
    try {
      const { error } = await supabase
        .from('unit_templates')
        .delete()
        .eq('id', unit.id);
      if (error) throw error;
      setTemplates(prev => prev.filter(t => t.id !== unit.id));
      setSelectedId(null);
      setUnit(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete unit');
    }
  };

  const updateUnit = (field: keyof UnitTemplate, value: any) => {
    if (!unit) return;
    setUnit({ ...unit, [field]: value });
  };

  const toggleFormation = (formationName: string) => {
    if (!unit) return;
    if (formationName === 'Scattered') return;
    const current = unit.formationAvailability || [];
    const index = current.indexOf(formationName);
    let newFormations: string[];
    if (index >= 0) {
      newFormations = current.filter(f => f !== formationName);
    } else {
      newFormations = [...current, formationName];
    }
    if (!newFormations.includes('Scattered')) {
      newFormations = ['Scattered', ...newFormations];
    }
    updateUnit('formationAvailability', newFormations);
  };

  // --- EARLY RETURN AFTER ALL HOOKS ---
  if (loading) return (
    <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
      Loading Unit Editor...
    </div>
  );

  // --- RENDER ---
  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-[#0d0d1a]">
        <h1 className="text-2xl font-bold text-white">Unit Editor</h1>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
        >
          Main Menu
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-white px-4 py-2 mx-4 mt-2 rounded">
          {error}
          <button className="ml-4 text-red-300 hover:text-red-100" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Unit List */}
        <div className="w-64 p-4 border-r border-gray-700 flex flex-col bg-[#0d0d1a]">
          <div className="flex gap-2 mb-4">
            <button
              onClick={handleNew}
              className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
            >
              New
            </button>
            <button
              onClick={handleClone}
              disabled={!unit}
              className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clone
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {templates.map(template => {
              const isSelected = template.id === selectedId;
              return (
                <div
                  key={template.id}
                  onClick={() => setSelectedId(template.id)}
                  className={`px-3 py-2 rounded cursor-pointer transition ${
                    isSelected
                      ? 'bg-yellow-500/20 border border-yellow-400'
                      : 'hover:bg-gray-800'
                  }`}
                >
                  <div className="font-medium truncate">{template.name}</div>
                  <div className="text-xs text-gray-400">
                    Cost: {template.costGp || 0}gp · {template.raceName || 'No Race'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mid Panel: Stats */}
        <div className="flex-1 p-6 overflow-y-auto bg-[#0d0d1a]">
          {unit ? (
            <div className="max-w-2xl space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={unit.name}
                  onChange={(e) => updateUnit('name', e.target.value)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Race */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Race</label>
                  <select
                    value={unit.raceId}
                    onChange={(e) => {
                      const race = races.find(r => r.id === e.target.value);
                      updateUnit('raceId', e.target.value);
                      if (race) updateUnit('raceName', race.name);
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    {races.map(race => (
                      <option key={race.id} value={race.id}>{race.name}</option>
                    ))}
                  </select>
                </div>

                {/* Level/HD */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Level / HD</label>
                  <input
                    type="number"
                    value={unit.level}
                    onChange={(e) => updateUnit('level', parseInt(e.target.value) || 1)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* HP */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">HP</label>
                  <input
                    type="number"
                    value={unit.hp}
                    onChange={(e) => updateUnit('hp', parseInt(e.target.value) || 10)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                {/* Body Count */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Body Count</label>
                  <input
                    type="number"
                    value={unit.bodyCount}
                    onChange={(e) => updateUnit('bodyCount', parseInt(e.target.value) || 1)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              {/* Base AC */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Base AC (Natural/Class)</label>
                <input
                  type="number"
                  value={unit.baseAc}
                  onChange={(e) => updateUnit('baseAc', parseInt(e.target.value) || 10)}
                  min={1}
                  max={30}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Armor */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Armor</label>
                  <select
                    value={unit.armorId}
                    onChange={(e) => {
                      const armor = armors.find(a => a.id === e.target.value);
                      updateUnit('armorId', e.target.value);
                      if (armor) updateUnit('armorName', armor.name);
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    {armors.map(armor => (
                      <option key={armor.id} value={armor.id}>{armor.name} (+{armor.acBonus} AC)</option>
                    ))}
                  </select>
                </div>

                {/* Shield */}
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={unit.isShielded}
                      onChange={(e) => updateUnit('isShielded', e.target.checked)}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Shield (+2 AC)
                  </label>
                </div>
              </div>

              {/* --- WEAPON EDITOR --- */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">Weapons</label>
                  <button
                    onClick={openAddWeapon}
                    className="px-3 py-1 text-sm bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                  >
                    + Add Weapon
                  </button>
                </div>

                {getWeapons().length === 0 ? (
                  <div className="text-sm text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-3 text-center">
                    No weapons added yet. Click "Add Weapon" to add one.
                  </div>
                ) : (
                  <div className="space-y-1 bg-gray-800/30 rounded border border-gray-700 p-2">
                    {getWeapons().map((w, index) => {
                      const rangeDisplay = w.range === 1 ? 'Adjacent' : `${w.range} hexes`;
                      const cost = getWeaponCost(w.name);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded hover:bg-gray-700 transition"
                        >
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="font-medium">{w.name}</span>
                            <span className="text-xs text-gray-400">{w.targetType}</span>
                            <span className="text-xs text-yellow-400">{w.damageDice}</span>
                            <span className="text-xs text-gray-400">{rangeDisplay}</span>
                            <span className="text-xs text-green-400">{cost > 0 ? `${cost}gp` : 'Free'}</span>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEditWeapon(index)}
                              className="text-xs bg-blue-700 hover:bg-blue-600 px-2 py-1 rounded text-white"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeWeapon(index)}
                              className="text-xs bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-white"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Mount */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Mount</label>
                  <select
                    value={unit.mountId}
                    onChange={(e) => {
                      const mount = mounts.find(m => m.id === e.target.value);
                      updateUnit('mountId', e.target.value);
                      if (mount) updateUnit('mountName', mount.name);
                      if (mount && mount.name !== 'None') {
                        const mountedModel = modelTypes.find(m => m.isMounted === true);
                        if (mountedModel) {
                          updateUnit('modelTypeId', mountedModel.id);
                          updateUnit('modelTypeName', mountedModel.name);
                        }
                      }
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    {mounts.map(mount => (
                      <option key={mount.id} value={mount.id}>{mount.name} (Speed: {mount.speed})</option>
                    ))}
                  </select>
                </div>

                {/* Aggressiveness */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Aggressiveness (1-10)</label>
                  <input
                    type="number"
                    value={unit.aggressiveness}
                    onChange={(e) => updateUnit('aggressiveness', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                    min={1}
                    max={10}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Base Morale */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Base Morale (1-10)</label>
                  <input
                    type="number"
                    value={unit.baseMorale}
                    onChange={(e) => updateUnit('baseMorale', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                    min={1}
                    max={10}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                {/* Movement Points */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Movement Points</label>
                  <input
                    type="number"
                    value={unit.movementPoints}
                    onChange={(e) => updateUnit('movementPoints', Math.max(1, parseInt(e.target.value) || 3))}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* isHero */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={unit.isHero}
                      onChange={(e) => updateUnit('isHero', e.target.checked)}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Hero Unit
                  </label>
                </div>
                {/* isPlayerHero */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={unit.isPlayerHero}
                      onChange={(e) => updateUnit('isPlayerHero', e.target.checked)}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Player Hero (ignores morale)
                  </label>
                </div>
              </div>

              {/* Formations */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Formation Availability</label>
                <div className="grid grid-cols-2 gap-2">
                  {formations.map(formation => (
                    <label key={formation.id} className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={unit.formationAvailability?.includes(formation.name) || false}
                        onChange={() => toggleFormation(formation.name)}
                        disabled={formation.name === 'Scattered'}
                        className={`w-4 h-4 accent-yellow-400 ${
                          formation.name === 'Scattered' ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      />
                      {formation.name}
                      {formation.name === 'Scattered' && (
                        <span className="text-xs text-gray-500">(Always available)</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* AC Special Modifier */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">AC Special Modifier</label>
                <input
                  type="text"
                  value={unit.acSpecialModifier}
                  onChange={(e) => updateUnit('acSpecialModifier', e.target.value)}
                  placeholder="e.g., +2 (Barbarian Rage) or -1 (Large Size)"
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                />
              </div>

              {/* Calculated fields */}
              <div className="grid grid-cols-4 gap-4 p-4 bg-gray-800 rounded border border-gray-700">
                <div>
                  <label className="block text-xs text-gray-400">AC (Auto)</label>
                  <div className="text-xl font-bold text-yellow-400">{getCurrentAC()}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Movement</label>
                  <div className="text-xl font-bold text-yellow-400">{getCurrentMovement()}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Cost (gp)</label>
                  <div className="text-xl font-bold text-yellow-400">{getCurrentCost()}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Weapons</label>
                  <div className="text-xl font-bold text-yellow-400">{getWeapons().length}</div>
                </div>
              </div>

              {/* Save buttons */}
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                >
                  Save
                </button>
                <button
                  onClick={handleSaveAs}
                  className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                >
                  Save As
                </button>
                <button
                  onClick={handleDelete}
                  className="px-6 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a unit from the list or create a new one
            </div>
          )}
        </div>

        {/* Right Panel: Images & Troop Scale */}
        <div className="w-64 p-4 border-l border-gray-700 bg-[#0d0d1a]">
          {unit ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Race Icon</label>
                <div className="w-full aspect-square bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-center">
                  <div className="text-gray-500 text-center">
                    <div className="text-6xl">🖼️</div>
                    <div className="text-xs mt-2">{unit.raceName || 'No Race'}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Model Type</label>
                <div className="w-full aspect-square bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-center">
                  <div className="text-gray-500 text-center">
                    <div className="text-6xl">⚔️</div>
                    <div className="text-xs mt-2">{unit.modelTypeName || 'No Model'}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Troop Scale: {unit.troopScale}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="400"
                  value={unit.troopScale}
                  onChange={(e) => updateUnit('troopScale', parseInt(e.target.value))}
                  className="w-full accent-yellow-400"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0%</span>
                  <span>100%</span>
                  <span>400%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-center">
              Select a unit<br />to see details
            </div>
          )}
        </div>
      </div>

      {/* Weapon Modal */}
      {showWeaponModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 max-h-[90vh] overflow-y-auto border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">
              {editingWeaponIndex !== null ? 'Edit Weapon' : 'Add Weapon'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Weapon Name</label>
                <div className="relative">
                  <input
                    type="text"
                    value={weaponSearchTerm}
                    onChange={(e) => {
                      setWeaponSearchTerm(e.target.value);
                      setWeaponName(e.target.value);
                      setShowWeaponSuggestions(true);
                    }}
                    onFocus={() => setShowWeaponSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowWeaponSuggestions(false), 200)}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                    placeholder="Type to search or enter custom name"
                  />
                  {showWeaponSuggestions && getWeaponSuggestions().length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg max-h-48 overflow-y-auto">
                      {getWeaponSuggestions().map((w) => (
                        <div
                          key={w.id}
                          className="px-3 py-2 hover:bg-gray-600 cursor-pointer text-white text-sm"
                          onMouseDown={() => selectWeaponFromLookup(w)}
                        >
                          {w.name} ({w.damage_dice}) - {w.cost_gp}gp
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Type to search existing weapons, or enter a custom name.
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Target Type</label>
                <select
                  value={weaponTargetType}
                  onChange={(e) => setWeaponTargetType(e.target.value as 'single' | 'area')}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                >
                  <option value="single">Single Target</option>
                  <option value="area">Area Effect</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Damage Dice</label>
                <input
                  type="text"
                  value={weaponDamageDice}
                  onChange={(e) => setWeaponDamageDice(e.target.value)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  placeholder="e.g., 1d6, 2d6+2, 1d4+2d6"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Examples: 1d6, 2d10, 2d6+2, 1d8-1, 1d4+2d6, 2d6+1d4+3
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Range (in hexes)</label>
                <input
                  type="number"
                  value={weaponRange}
                  onChange={(e) => setWeaponRange(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {weaponRange === 1 ? 'Adjacent (melee)' : `${weaponRange} hexes (ranged)`}
                </p>
              </div>
              {weaponError && <p className="text-red-400 text-sm">{weaponError}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => { setShowWeaponModal(false); setWeaponError(''); }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={saveWeapon}
              >
                {editingWeaponIndex !== null ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Modal */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">
              {unit && unit.id ? 'Clone Unit' : 'Save As'}
            </h2>
            <div>
              <label className="block text-sm text-gray-300 mb-1">New Unit Name</label>
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="Enter unit name"
              />
            </div>
            {cloneError && <p className="text-red-400 text-sm mt-2">{cloneError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => { setShowCloneModal(false); setCloneError(''); }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={confirmClone}
              >
                {unit && unit.id ? 'Clone' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}