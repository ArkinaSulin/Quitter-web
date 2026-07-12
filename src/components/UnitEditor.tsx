// src/components/UnitEditor.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { UnitTemplate, Race, Armor, Formation, UnitType, Mount } from '@/types/gameProtocol';
import { parseWeapons, stringifyWeapons, Weapon as WeaponType } from '@/lib/weaponParser';
import { TokenPreview } from '@/components/TokenRenderer/TokenPreview';
import { Team } from '@/components/TokenRenderer/tokenUtils';

function mapTemplate(row: any): UnitTemplate {
  return {
    id: row.id,
    name: row.name,
    raceId: row.race_id || '',
    raceName: row.races?.name || '',
    raceBaseHd: row.races?.base_hd || null,
    modelTypeId: row.model_type_id || '',
    modelTypeName: row.unit_types?.name || '',
    modelTypeIconUrl: row.unit_types?.icon_url || null,
    isHero: row.is_hero || false,
    isPlayerHero: row.is_player_hero || false,
    bodyCount: row.body_count || 1,
    level: row.level || 1,
    hp: row.hp || 10,
    unitHp: row.unit_hp || 0,
    attack: row.attack || 10,
    armorId: row.armor_id || '',
    armorName: row.armors?.name || '',
    isShielded: row.is_shielded || false,
    baseAc: row.base_ac || 10,
    weaponString: row.weapon_string || '',
    mountId: row.mount_id || '',
    mountName: row.mounts?.name || '',
    movementPoints: row.movement_points || 3,
    aggressiveness: row.aggressiveness || 3,
    baseMorale: row.base_morale || 3,
    troopScale: row.troop_scale || 100,
    formationAvailability: row.formation_availability || ['Scattered', 'Routed'],
    costGp: row.cost_gp || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplateToRow(template: UnitTemplate) {
  const unitHp = (template.hp || 0) * (template.bodyCount || 1);
  const attack = getAttackFromLevel(template.level || 1);
  return {
    id: template.id,
    name: template.name,
    race_id: template.raceId || null,
    model_type_id: template.modelTypeId || null,
    is_hero: template.isHero || false,
    is_player_hero: template.isPlayerHero || false,
    body_count: template.bodyCount || 1,
    level: template.level || 1,
    hp: template.hp || 10,
    unit_hp: unitHp,
    attack: attack,
    armor_id: template.armorId || null,
    is_shielded: template.isShielded || false,
    base_ac: template.baseAc || 10,
    weapon_string: template.weaponString || '',
    mount_id: template.mountId || null,
    movement_points: template.movementPoints || 3,
    aggressiveness: template.aggressiveness || 3,
    base_morale: template.baseMorale || 3,
    troop_scale: template.troopScale || 100,
    formation_availability: template.formationAvailability || ['Scattered', 'Routed'],
    cost_gp: template.costGp || 0,
    updated_at: new Date().toISOString(),
  };
}

function getAttackFromLevel(level: number): number {
  const profBonus = getProficiencyBonus(level);
  return 8 + profBonus;
}

function getProficiencyBonus(level: number): number {
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
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
  const [success, setSuccess] = useState<string | null>(null);

  const [races, setRaces] = useState<Race[]>([]);
  const [weaponsLookup, setWeaponsLookup] = useState<
    { id: string; name: string; damage_dice: string; special: string | null; cost_gp: number; attack_bonus?: number; magic_radius?: number }[]
  >([]);
  const [armors, setArmors] = useState<Armor[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);

  const [formData, setFormData] = useState<UnitTemplate | null>(null);
  const [previewTeam, setPreviewTeam] = useState<Team>('blue');

  const [testCasualtyPercent, setTestCasualtyPercent] = useState<number>(0);
  const [testMoralePercent, setTestMoralePercent] = useState<number>(100);
  const [testFormation, setTestFormation] = useState<'Loose' | 'Tight' | 'Scattered' | 'Phalanx' | 'Shield Wall' | 'Routed'>('Loose');

  const [showWeaponModal, setShowWeaponModal] = useState(false);
  const [editingWeaponIndex, setEditingWeaponIndex] = useState<number | null>(null);
  const [weaponName, setWeaponName] = useState('');
  const [weaponAttackBonus, setWeaponAttackBonus] = useState<number>(0);
  const [weaponTargetType, setWeaponTargetType] = useState<'single' | 'area'>('single');
  const [weaponDamageDice, setWeaponDamageDice] = useState('1d6');
  const [weaponRange, setWeaponRange] = useState(1);
  const [weaponMagicRadius, setWeaponMagicRadius] = useState<number>(0);
  const [weaponError, setWeaponError] = useState('');
  const [weaponSearchTerm, setWeaponSearchTerm] = useState('');
  const [showWeaponSuggestions, setShowWeaponSuggestions] = useState(false);

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  const getWeapons = (): WeaponType[] => {
    if (!formData) return [];
    return parseWeapons(formData.weaponString);
  };

  const getWeaponCost = (weaponName: string): number => {
    if (!weaponName || weaponName.trim() === '') return 0;
    const found = weaponsLookup.find(w => w.name.toLowerCase() === weaponName.toLowerCase());
    return found?.cost_gp || 0;
  };

  const calculateAC = () => {
    if (!formData) return 10;
    const selectedRace = races.find(r => r.id === formData.raceId);
    const selectedArmor = formData.armorId ? armors.find(a => a.id === formData.armorId) : null;
    let ac = formData.baseAc + (selectedArmor?.ac_bonus || 0) + (formData.isShielded ? 2 : 0) + (selectedRace?.acBonus || 0);
    return Math.max(0, Math.min(30, ac));
  };

  const calculateMovement = () => {
    if (!formData) return 3;
    const selectedArmor = formData.armorId ? armors.find(a => a.id === formData.armorId) : null;
    const selectedMount = formData.mountId ? mounts.find(m => m.id === formData.mountId) : null;
    let movement = formData.movementPoints || 3;
    if (selectedMount && selectedMount.name !== 'None' && selectedMount.speed > movement) {
      movement = selectedMount.speed;
    }
    movement -= (selectedArmor?.movement_penalty || 0);
    return Math.max(1, movement);
  };

  const calculateCost = () => {
    if (!formData) return 0;
    const selectedArmor = formData.armorId ? armors.find(a => a.id === formData.armorId) : null;
    const selectedMount = formData.mountId ? mounts.find(m => m.id === formData.mountId) : null;
    let cost = 0;
    const weapons = getWeapons();
    for (const w of weapons) {
      const weaponCost = getWeaponCost(w.name);
      cost += weaponCost || 0;
    }
    if (selectedArmor) cost += selectedArmor?.cost_gp || 0;
    if (formData.isShielded) cost += 10;
    if (selectedMount) cost += selectedMount?.cost_gp || 0;
    return cost || 0;
  };

  const updateFormData = (field: keyof UnitTemplate, value: any) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
  };

  const toggleFormation = (formationName: string) => {
    if (!formData) return;
    const isMounted = formData.mountId !== '';
    if (isMounted && (formationName === 'Phalanx' || formationName === 'Shield Wall')) return;
    if (formationName === 'Scattered' || formationName === 'Routed') return;
    const current = formData.formationAvailability || ['Scattered', 'Routed'];
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
    if (!newFormations.includes('Routed')) {
      newFormations = [...newFormations, 'Routed'];
    }
    updateFormData('formationAvailability', newFormations);
  };

  useEffect(() => {
    if (!formData) return;
    const isMounted = formData.mountId !== '';
    if (isMounted) {
      const current = formData.formationAvailability || ['Scattered', 'Routed'];
      const filtered = current.filter(f => f !== 'Phalanx' && f !== 'Shield Wall');
      if (filtered.length !== current.length) {
        setFormData({ ...formData, formationAvailability: filtered });
      }
    }
  }, [formData?.mountId]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: templateData, error: templateError } = await supabase
          .from('unit_templates')
          .select(`
            *,
            races(name, icon_url, base_hd),
            unit_types(name, icon_url),
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
          unitTypesRes,
          mountsRes,
        ] = await Promise.all([
          supabase.from('races').select('*').order('name'),
          supabase.from('weapons').select('*').order('name'),
          supabase.from('armors').select('*').order('name'),
          supabase.from('formations').select('*').order('name'),
          supabase.from('unit_types').select('*').order('name'),
          supabase.from('mounts').select('*').order('name'),
        ]);

        if (racesRes.error) throw racesRes.error;
        if (weaponsRes.error) throw weaponsRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (formationsRes.error) throw formationsRes.error;
        if (unitTypesRes.error) throw unitTypesRes.error;
        if (mountsRes.error) throw mountsRes.error;

        setRaces(racesRes.data || []);
        setWeaponsLookup(weaponsRes.data || []);
        setArmors(armorsRes.data || []);
        setFormations(formationsRes.data || []);
        setUnitTypes(unitTypesRes.data || []);
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

  useEffect(() => {
    if (selectedId) {
      const found = templates.find(t => t.id === selectedId);
      if (found) {
        setFormData({ ...found });
        setError(null);
        setSuccess(null);
      } else {
        setFormData(null);
      }
    } else {
      setFormData(null);
    }
  }, [selectedId, templates]);

  const openAddWeapon = () => {
    setEditingWeaponIndex(null);
    setWeaponName('');
    setWeaponSearchTerm('');
    setWeaponTargetType('single');
    setWeaponDamageDice('1d6');
    setWeaponRange(1);
    setWeaponAttackBonus(0);
    setWeaponMagicRadius(0);
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
    setWeaponAttackBonus(w.attackBonus);
    setWeaponMagicRadius(w.magicRadius);
    setWeaponError('');
    setShowWeaponSuggestions(false);
    setShowWeaponModal(true);
  };

  const selectWeaponFromLookup = (weapon: {
    id: string;
    name: string;
    damage_dice: string;
    special: string | null;
    cost_gp: number;
    attack_bonus?: number;
    magic_radius?: number;
  }) => {
    setWeaponName(weapon.name);
    setWeaponSearchTerm(weapon.name);
    setWeaponDamageDice(weapon.damage_dice);
    setWeaponAttackBonus(weapon.attack_bonus || 0);
    if (weapon.special?.includes('Range')) {
      setWeaponTargetType('single');
      setWeaponRange(6);
      setWeaponMagicRadius(0);
    } else if (weapon.name.toLowerCase().includes('fireball') || weapon.name.toLowerCase().includes('area')) {
      setWeaponTargetType('area');
      setWeaponRange(4);
      setWeaponMagicRadius(weapon.magic_radius || 2);
    } else {
      setWeaponTargetType('single');
      setWeaponRange(1);
      setWeaponMagicRadius(0);
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
    if (!formData) return;
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
    if (weaponTargetType === 'area' && weaponMagicRadius < 0) {
      setWeaponError('Magic Radius must be 0 or positive');
      return;
    }

    const newWeapon: WeaponType = {
      name: weaponName.trim(),
      attackBonus: weaponAttackBonus || 0,
      targetType: weaponTargetType,
      damageDice: weaponDamageDice.trim(),
      range: weaponRange,
      magicRadius: weaponTargetType === 'area' ? weaponMagicRadius : 0,
    };

    const currentWeapons = getWeapons();
    let updatedWeapons: WeaponType[];
    if (editingWeaponIndex !== null) {
      updatedWeapons = [...currentWeapons];
      updatedWeapons[editingWeaponIndex] = newWeapon;
    } else {
      updatedWeapons = [...currentWeapons, newWeapon];
    }

    const weaponString = stringifyWeapons(updatedWeapons);
    updateFormData('weaponString', weaponString);
    setShowWeaponModal(false);
    setWeaponError('');
  };

  const removeWeapon = (index: number) => {
    if (!formData) return;
    const currentWeapons = getWeapons();
    const updatedWeapons = currentWeapons.filter((_, i) => i !== index);
    const weaponString = stringifyWeapons(updatedWeapons);
    updateFormData('weaponString', weaponString);
  };

  const createBlankTemplate = (): UnitTemplate => {
    const firstRace = races[0];
    const firstUnitType = unitTypes[0];
    return {
      id: crypto.randomUUID(),
      name: 'New Unit',
      raceId: firstRace?.id || '',
      raceName: firstRace?.name || '',
      raceBaseHd: firstRace?.base_hd || null,
      modelTypeId: firstUnitType?.id || '',
      modelTypeName: firstUnitType?.name || '',
      modelTypeIconUrl: firstUnitType?.icon_url || null,
      isHero: false,
      isPlayerHero: false,
      bodyCount: 1,
      level: 1,
      hp: firstRace?.base_hd || 10,
      unitHp: (firstRace?.base_hd || 10) * 1,
      attack: 10,
      armorId: '',
      armorName: '',
      isShielded: false,
      baseAc: 10,
      weaponString: '',
      mountId: '',
      mountName: '',
      movementPoints: 3,
      aggressiveness: 3,
      baseMorale: 3,
      troopScale: 100,
      formationAvailability: ['Scattered', 'Routed'],
      costGp: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleNew = () => {
    const blank = createBlankTemplate();
    setFormData(blank);
    setSelectedId(null);
    setError(null);
    setSuccess(null);
  };

  const handleClone = () => {
    if (!formData) return;
    setCloneName(`${formData.name} (Clone)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const confirmClone = async () => {
    if (!formData) return;
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
        ...formData,
        id: crypto.randomUUID(),
        name: cloneName.trim(),
        costGp: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formationAvailability: [...formData.formationAvailability],
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
      setFormData(mapped);
      setShowCloneModal(false);
      setCloneName('');
      setSuccess(`Unit "${mapped.name}" cloned successfully!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setCloneError(err.message || 'Failed to clone unit');
    }
  };

  const handleSave = async () => {
    if (!formData) {
      setError('No unit selected to save');
      return;
    }

    if (!formData.name.trim()) {
      setError('Unit name is required');
      return;
    }

    const duplicate = templates.find(t => t.name === formData.name.trim() && t.id !== formData.id);
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
      const selectedRace = races.find(r => r.id === formData.raceId);
      const selectedArmor = formData.armorId ? armors.find(a => a.id === formData.armorId) : null;
      const selectedMount = formData.mountId ? mounts.find(m => m.id === formData.mountId) : null;

      let ac = formData.baseAc + (selectedArmor?.ac_bonus || 0) + (formData.isShielded ? 2 : 0) + (selectedRace?.acBonus || 0);
      ac = Math.max(0, Math.min(30, ac));

      let movement = formData.movementPoints || 3;
      if (selectedMount && selectedMount.name !== 'None' && selectedMount.speed > movement) {
        movement = selectedMount.speed;
      }
      movement -= (selectedArmor?.movement_penalty || 0);
      const finalMovement = Math.max(1, movement);

      let cost = 0;
      const parsedWeapons = getWeapons();
      for (const w of parsedWeapons) {
        cost += getWeaponCost(w.name);
      }
      if (selectedArmor) cost += selectedArmor.cost_gp || 0;
      if (formData.isShielded) cost += 10;
      if (selectedMount) cost += selectedMount.cost_gp || 0;

      const updatedUnit = {
        ...formData,
        ac: ac,
        movementPoints: finalMovement,
        costGp: cost || 0,
        attack: getAttackFromLevel(formData.level || 1),
        updatedAt: new Date().toISOString(),
      };

      const rowData = mapTemplateToRow(updatedUnit);

      const existsInDB = templates.some(t => t.id === formData.id);
      let result;

      if (existsInDB) {
        console.log('🔄 Updating existing unit:', formData.id);
        const { data, error } = await supabase
          .from('unit_templates')
          .update(rowData)
          .eq('id', formData.id)
          .select();

        if (error) {
          console.error('❌ Update error:', error);
          throw error;
        }
        result = data;
        console.log('✅ Update result:', result);
      } else {
        console.log('🟢 Inserting new unit');
        const { id, ...insertData } = rowData;
        const { data, error } = await supabase
          .from('unit_templates')
          .insert(insertData)
          .select();

        if (error) {
          console.error('❌ Insert error:', error);
          throw error;
        }
        result = data;
        console.log('✅ Insert result:', result);
      }

      if (!result || result.length === 0) {
        console.error('⚠️ No data returned. result:', result);
        throw new Error('No data returned from save operation');
      }

      const mapped = mapTemplate(result[0]);

      if (existsInDB) {
        setTemplates(prev => prev.map(t => t.id === mapped.id ? mapped : t));
      } else {
        setTemplates(prev => [...prev, mapped]);
        setSelectedId(mapped.id);
      }

      setFormData(mapped);

      setError(null);
      setSuccess(`Unit "${mapped.name}" saved successfully!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('💥 Save error:', err);
      setError(err.message || 'Failed to save unit');
    }
  };

  const handleSaveAs = () => {
    if (!formData) return;
    setCloneName(`${formData.name} (Copy)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const handleDelete = async () => {
    if (!formData) return;
    if (!confirm(`Delete unit "${formData.name}"?`)) return;
    try {
      const { error } = await supabase
        .from('unit_templates')
        .delete()
        .eq('id', formData.id);
      if (error) throw error;
      setTemplates(prev => prev.filter(t => t.id !== formData.id));
      setSelectedId(null);
      setFormData(null);
      setSuccess(`Unit deleted successfully!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete unit');
    }
  };

  if (loading) return (
    <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
      Loading Unit Editor...
    </div>
  );

  const sortedArmors = [...armors].sort((a, b) => (a.ac_bonus || 0) - (b.ac_bonus || 0));
  const selectedRace = races.find(r => r.id === formData?.raceId);
  const selectedUnitType = unitTypes.find(ut => ut.id === formData?.modelTypeId);

  const effectiveBodyCount = formData ? Math.round((formData.bodyCount || 1) * (1 - testCasualtyPercent / 100)) : 0;
  const effectiveMorale = formData ? Math.round((formData.baseMorale || 3) * (testMoralePercent / 100)) : 0;
  const isMountedPreview = formData?.mountId !== '';

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
      {success && (
        <div className="bg-green-900/50 border border-green-500 text-white px-4 py-2 mx-4 mt-2 rounded">
          {success}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-1/4 max-w-[256px] flex-shrink-0 p-4 border-r border-gray-700 flex flex-col bg-[#0d0d1a]">
          <div className="flex gap-2 mb-4">
            <button
              onClick={handleNew}
              className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
            >
              New
            </button>
            <button
              onClick={handleClone}
              disabled={!formData}
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
                  className={`px-3 py-2 rounded cursor-pointer transition border ${
                    isSelected
                      ? 'bg-yellow-500/20 border-yellow-400'
                      : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
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

        {/* Center Panel */}
        <div className="flex-1 min-w-0 p-6 overflow-y-auto bg-[#0d0d1a]">
          {formData ? (
            <div className="max-w-3xl space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => updateFormData('name', e.target.value)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                />
              </div>

              {/* Race & Level */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Race</label>
                  <select
                    key={`race-${formData.raceId || 'none'}`}
                    value={formData.raceId || ''}
                    onChange={(e) => {
                      const race = races.find(r => r.id === e.target.value);
                      const currentHp = formData?.hp || 0;
                      const newHp = (race?.base_hd && (currentHp === 10 || currentHp === 0)) ? race.base_hd : currentHp;
                      setFormData(prev => prev ? {
                        ...prev,
                        raceId: e.target.value,
                        raceName: race?.name || '',
                        hp: newHp,
                      } : null);
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    <option value="">Select a race...</option>
                    {races.map(race => (
                      <option key={race.id} value={race.id}>{race.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Level / HD</label>
                  <input
                    type="number"
                    value={formData.level || 1}
                    onChange={(e) => updateFormData('level', parseInt(e.target.value) || 1)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              {/* HP, Troop Count, Unit HP */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">HP</label>
                  <input
                    type="number"
                    value={formData.hp || 10}
                    onChange={(e) => updateFormData('hp', parseInt(e.target.value) || 10)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Troop Count</label>
                  <input
                    type="number"
                    value={formData.bodyCount || 1}
                    onChange={(e) => updateFormData('bodyCount', parseInt(e.target.value) || 1)}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Unit HP (Auto)</label>
                  <input
                    type="text"
                    value={(formData.hp || 0) * (formData.bodyCount || 1)}
                    disabled
                    className="w-full bg-gray-700 text-yellow-400 px-3 py-2 rounded border border-gray-600 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Base AC, Attack, Movement */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Base AC (Natural/Class)</label>
                  <input
                    type="number"
                    value={formData.baseAc || 10}
                    onChange={(e) => updateFormData('baseAc', parseInt(e.target.value) || 10)}
                    min={1}
                    max={30}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Attack (Auto)</label>
                  <input
                    type="text"
                    value={getAttackFromLevel(formData.level || 1)}
                    disabled
                    className="w-full bg-gray-700 text-yellow-400 px-3 py-2 rounded border border-gray-600 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Movement Points</label>
                  <input
                    type="number"
                    value={formData.movementPoints || 3}
                    onChange={(e) => updateFormData('movementPoints', Math.max(1, parseInt(e.target.value) || 3))}
                    min={1}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              {/* Armor, Shield, Mount in ONE ROW */}
              <div className="grid grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Armor</label>
                  <select
                    key={`armor-${formData.armorId || 'none'}`}
                    value={formData.armorId || ''}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      const armor = armors.find(a => a.id === selectedValue);
                      setFormData(prev => prev ? {
                        ...prev,
                        armorId: selectedValue,
                        armorName: armor?.name || ''
                      } : null);
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    <option value="">No Armor</option>
                    {sortedArmors.map(armor => (
                      <option key={armor.id} value={armor.id}>
                        {armor.name} (+{armor.ac_bonus || 0} AC) - {armor.cost_gp || 0}gp
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center h-full">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.isShielded || false}
                      onChange={(e) => {
                        setFormData(prev => prev ? { ...prev, isShielded: e.target.checked } : null);
                      }}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Shield (+2 AC)
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Mount</label>
                  <select
                    key={`mount-${formData.mountId || 'none'}`}
                    value={formData.mountId || ''}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      const mount = mounts.find(m => m.id === selectedValue);
                      setFormData(prev => prev ? {
                        ...prev,
                        mountId: selectedValue,
                        mountName: mount?.name || ''
                      } : null);
                      if (mount && mount.name !== 'None') {
                        const mountedUnitType = unitTypes.find(m => m.isMounted === true);
                        if (mountedUnitType) {
                          setFormData(prev => prev ? {
                            ...prev,
                            modelTypeId: mountedUnitType.id,
                            modelTypeName: mountedUnitType.name
                          } : null);
                        }
                      }
                    }}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  >
                    <option value="">No Mount</option>
                    {mounts.map(mount => (
                      <option key={mount.id} value={mount.id}>
                        {mount.name} (Speed: {mount.speed}) - {mount.cost_gp || 0}gp
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Aggressiveness & Base Morale in ONE ROW */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Aggressiveness (1-10)</label>
                  <input
                    type="number"
                    value={formData.aggressiveness || 3}
                    onChange={(e) => updateFormData('aggressiveness', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                    min={1}
                    max={10}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Base Morale (1-10)</label>
                  <input
                    type="number"
                    value={formData.baseMorale || 3}
                    onChange={(e) => updateFormData('baseMorale', Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                    min={1}
                    max={10}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>
              </div>

              {/* Hero Checkboxes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.isHero || false}
                      onChange={(e) => updateFormData('isHero', e.target.checked)}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Hero Unit
                  </label>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <input
                      type="checkbox"
                      checked={formData.isPlayerHero || false}
                      onChange={(e) => updateFormData('isPlayerHero', e.target.checked)}
                      className="w-4 h-4 accent-yellow-400"
                    />
                    Player Hero (ignores morale)
                  </label>
                </div>
              </div>

              {/* Weapons */}
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
                      const attackDisplay = w.attackBonus !== undefined ? `+${w.attackBonus}` : '';
                      const radiusDisplay = w.magicRadius > 0 ? `, r${w.magicRadius}` : '';
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
                            <span className="text-xs text-yellow-400">{attackDisplay}</span>
                            <span className="text-xs text-gray-400">{radiusDisplay}</span>
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

              {/* Formations */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Formation Availability</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    {formations
                      .filter(f => ['Tight', 'Loose', 'Scattered'].includes(f.name))
                      .sort((a, b) => {
                        const order = ['Tight', 'Loose', 'Scattered'];
                        return order.indexOf(a.name) - order.indexOf(b.name);
                      })
                      .map(formation => {
                        const isMounted = formData.mountId !== '';
                        const isPhalanxShieldWall = (formation.name === 'Phalanx' || formation.name === 'Shield Wall');
                        const disabled = isMounted && isPhalanxShieldWall;
                        return (
                          <label key={formation.id} className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                              type="checkbox"
                              checked={formData.formationAvailability?.includes(formation.name) || false}
                              onChange={() => toggleFormation(formation.name)}
                              disabled={disabled || formation.name === 'Scattered'}
                              className={`w-4 h-4 accent-yellow-400 ${
                                (disabled || formation.name === 'Scattered') ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                            />
                            {formation.name}
                            {formation.name === 'Scattered' && (
                              <span className="text-xs text-gray-500">(Always available)</span>
                            )}
                            {disabled && (
                              <span className="text-xs text-gray-500">(Not for mounted)</span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                  <div className="space-y-2">
                    {formations
                      .filter(f => ['Phalanx', 'Shield Wall'].includes(f.name))
                      .map(formation => {
                        const isMounted = formData.mountId !== '';
                        const disabled = isMounted;
                        return (
                          <label key={formation.id} className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                              type="checkbox"
                              checked={formData.formationAvailability?.includes(formation.name) || false}
                              onChange={() => toggleFormation(formation.name)}
                              disabled={disabled}
                              className={`w-4 h-4 accent-yellow-400 ${
                                disabled ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                            />
                            {formation.name}
                            {disabled && (
                              <span className="text-xs text-gray-500">(Not for mounted)</span>
                            )}
                          </label>
                        );
                      })}
                    <label className="flex items-center gap-2 text-sm text-gray-400">
                      <input
                        type="checkbox"
                        checked={true}
                        disabled
                        className="w-4 h-4 accent-yellow-400 opacity-50 cursor-not-allowed"
                      />
                      Routed
                      <span className="text-xs text-gray-500">(Always available)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Calculated fields summary */}
              <div className="grid grid-cols-4 gap-4 p-4 bg-gray-800 rounded border border-gray-700">
                <div>
                  <label className="block text-xs text-gray-400">AC (Auto)</label>
                  <div className="text-xl font-bold text-yellow-400">{calculateAC()}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Movement</label>
                  <div className="text-xl font-bold text-yellow-400">{calculateMovement()}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Cost (gp)</label>
                  <div className="text-xl font-bold text-yellow-400">{calculateCost()}</div>
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

        {/* Right Panel */}
        <div className="flex-[0_0_30%] min-w-[240px] max-w-[40%] p-4 border-l border-gray-700 bg-[#0d0d1a] overflow-y-auto">
          {formData ? (
            <div className="space-y-6">
              {/* Token Preview */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Token Preview</label>
                <div className="flex flex-col items-center">
                  <TokenPreview
                    unitName={formData.name || 'Unit'}
                    bodyCount={effectiveBodyCount}
                    maxBodyCount={formData.bodyCount || 1}
                    formation={testFormation}
                    team={previewTeam}
                    troopScale={formData.troopScale || 100}
                    isMounted={isMountedPreview}
                    isRouted={testFormation === 'Routed'}
                    morale={effectiveMorale}
                    maxMorale={formData.baseMorale || 3}
                    raceIconUrl={selectedRace?.icon_url}
                    weaponIconUrl={selectedUnitType?.icon_url || undefined}
                    width={200}
                  />

                  <div className="mt-2 w-full max-w-[200px]">
                    <label className="block text-xs text-gray-400 mb-1">Team</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['blue', 'yellow', 'violet', 'black', 'orange', 'green'] as Team[]).map((t) => (
                        <label key={t} className="flex items-center gap-1 text-xs text-gray-300">
                          <input
                            type="radio"
                            name="previewTeam"
                            value={t}
                            checked={previewTeam === t}
                            onChange={() => setPreviewTeam(t)}
                            className="accent-yellow-400"
                          />
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Test Controls */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Casualty test: {testCasualtyPercent}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={testCasualtyPercent}
                  onChange={(e) => setTestCasualtyPercent(parseInt(e.target.value))}
                  className="w-full accent-yellow-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Morale test: {testMoralePercent}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={testMoralePercent}
                  onChange={(e) => setTestMoralePercent(parseInt(e.target.value))}
                  className="w-full accent-yellow-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Formation</label>
                <div className="grid grid-cols-2 gap-1">
                  {['Loose', 'Tight', 'Scattered', 'Phalanx', 'Shield Wall', 'Routed'].map((f) => (
                    <label key={f} className="flex items-center gap-1 text-xs text-gray-300">
                      <input
                        type="radio"
                        name="testFormation"
                        value={f}
                        checked={testFormation === f}
                        onChange={() => setTestFormation(f as any)}
                        className="accent-yellow-400"
                      />
                      {f}
                    </label>
                  ))}
                </div>
              </div>

              {/* Unit Type Icon Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Unit Type Icon</label>
                <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 border border-gray-700 rounded bg-gray-800/30">
                  {unitTypes.map((ut) => {
                    const isSelected = formData.modelTypeId === ut.id;
                    return (
                      <div
                        key={ut.id}
                        onClick={() => {
                          updateFormData('modelTypeId', ut.id);
                          updateFormData('modelTypeName', ut.name);
                        }}
                        className={`border-2 rounded p-1 cursor-pointer transition flex flex-col items-center ${
                          isSelected ? 'border-yellow-400 bg-yellow-400/20' : 'border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {ut.icon_url ? (
                          <Image
                            src={ut.icon_url}
                            alt={ut.name}
                            width={40}
                            height={40}
                            className="object-contain"
                            unoptimized
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400">
                            {ut.name.substring(0, 2)}
                          </div>
                        )}
                        <span className="text-[10px] text-gray-400 truncate w-full text-center mt-1">{ut.name}</span>
                      </div>
                    );
                  })}
                  {unitTypes.length === 0 && (
                    <div className="col-span-4 text-sm text-gray-500 text-center py-4">
                      No unit types found in database.
                    </div>
                  )}
                </div>
              </div>

              {/* Troop Scale */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Troop Scale: {formData.troopScale || 100}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="400"
                  value={formData.troopScale || 100}
                  onChange={(e) => updateFormData('troopScale', parseInt(e.target.value))}
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
                <p className="text-xs text-gray-400 mt-1">Type to search existing weapons, or enter a custom name.</p>
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
                <p className="text-xs text-gray-400 mt-1">Examples: 1d6, 2d10, 2d6+2, 1d8-1, 1d4+2d6, 2d6+1d4+3</p>
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
                <p className="text-xs text-gray-400 mt-1">{weaponRange === 1 ? 'Adjacent (melee)' : `${weaponRange} hexes (ranged)`}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Attack Bonus</label>
                <input
                  type="number"
                  value={weaponAttackBonus}
                  onChange={(e) => setWeaponAttackBonus(parseInt(e.target.value) || 0)}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  placeholder="e.g., 5"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Magic Radius (hexes)</label>
                <input
                  type="number"
                  value={weaponMagicRadius}
                  onChange={(e) => setWeaponMagicRadius(Math.max(0, parseInt(e.target.value) || 0))}
                  min={0}
                  className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  placeholder="0 for single target"
                />
                <p className="text-xs text-gray-400 mt-1">Only used for area spells.</p>
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
              {formData && formData.id ? 'Clone Unit' : 'Save As'}
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
                {formData && formData.id ? 'Clone' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}