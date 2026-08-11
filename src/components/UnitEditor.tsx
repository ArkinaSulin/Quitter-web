// src/components/UnitEditor.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { supabase } from '@/lib/supabaseClient';
import { UnitTemplate, Race, Armor, Formation, UnitType, Mount, SizeCategory } from '@/types/gameProtocol';
import { parseWeapons, stringifyWeapons, Weapon as WeaponType, formatWeaponDisplay, SaveStat } from '@/lib/weaponParser';
import { WeaponEditorModal } from '@/components/WeaponEditorModal';
import { TokenPreview } from '@/components/TokenRenderer/TokenPreview';
import { Team } from '@/components/TokenRenderer/tokenUtils';
import { mapTemplate, mapTemplateToRow } from '@/lib/templateMappers';
import { raceIconFromName } from '@/lib/imageUrls';

const SIZE_LABELS: Record<number, string> = {
  75: 'Small',
  100: 'Medium',
  200: 'Large',
  300: 'Huge',
  400: 'Gargantuan',
};

const SIZE_VALUES = [75, 100, 200, 300, 400];

function snapSizeCategory(value: number): number {
  const closest = SIZE_VALUES.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );
  return closest;
}

const SIZE_SLIDER_VALUES = [75, 100, 200, 300, 400];

function Cell({ label, children, widthClass = 'w-16' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 text-[10px] text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, disabled }: {
  value: any; onChange: (v: number) => void; min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={e => onChange(parseInt(e.target.value) || 0)}
      className={`w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    />
  );
}

function ReadBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-gray-700 text-yellow-400 text-xs rounded px-2 py-1 border border-gray-600 opacity-80">
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-1.5 text-[11px] text-gray-300 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-yellow-400" />
      {label}
    </label>
  );
}

export default function UnitEditor() {
  const router = useRouter();
  const [templates, setTemplates] = useState<UnitTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unitSearchTerm, setUnitSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [races, setRaces] = useState<Race[]>([]);
  const [weaponsLookup, setWeaponsLookup] = useState<
    { id: string; name: string; damage_dice: string; notes: string | null; cost_gp: number; attack_bonus?: number; magic_radius?: number; range?: number; max_range?: number; reach?: boolean; is_two_handed?: boolean; number_of_attacks?: number; no_retaliation?: boolean; free_action?: boolean; on_save_half_or_neg?: boolean; saving_throw?: SaveStat }[]
  >([]);
  const [armors, setArmors] = useState<Armor[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [sizeCategories, setSizeCategories] = useState<SizeCategory[]>([]);

  const [formData, setFormData] = useState<UnitTemplate | null>(null);
  const [previewTeam, setPreviewTeam] = useState<Team>('blue');

  const [testCasualtyPercent, setTestCasualtyPercent] = useState<number>(0);
  const [testMoraleModifier, setTestMoraleModifier] = useState<number>(0);
  const [testFormation, setTestFormation] = useState<'Open Order' | 'Close Order' | 'Scattered' | 'Phalanx' | 'Shield Wall' | 'Routed'>('Open Order');
  const [testCharge, setTestCharge] = useState(false);

  const getMaxTroopForSize = useCallback((sizeCategory: number, isMounted: boolean): number => {
    const sc = sizeCategories.find(s => s.size_category === sizeCategory);
    if (!sc) {
      if (sizeCategory >= 400) return 1;
      if (sizeCategory >= 300) return 6;
      if (sizeCategory >= 200) return 20;
      return isMounted ? 40 : 80;
    }
    return isMounted ? sc.max_troops_mounted : sc.max_troops;
  }, [sizeCategories]);

  const [showWeaponModal, setShowWeaponModal] = useState(false);
  const [editingWeaponIndex, setEditingWeaponIndex] = useState<number | null>(null);

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  const [previousHeroBodyCount, setPreviousHeroBodyCount] = useState<number>(10);
  const [wasHeroChecked, setWasHeroChecked] = useState<boolean>(false);
  const [previousHeroState, setPreviousHeroState] = useState<boolean>(false);
  const [previousBodyCount, setPreviousBodyCount] = useState<number>(10);
  const [wasAt400, setWasAt400] = useState<boolean>(false);

  const [showImagePicker, setShowImagePicker] = useState(false);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(400);
  const previewWidthRef = useRef(previewWidth);
  const observerRef = useRef<ResizeObserver | null>(null);

  const openImagePicker = () => {
    if (!formData) return;
    setShowImagePicker(true);
  };

  const updatePreviewWidth = () => {
    const container = previewContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const newWidth = Math.floor(rect.width - 16);
    if (newWidth > 0 && newWidth !== previewWidthRef.current) {
      setPreviewWidth(newWidth);
      previewWidthRef.current = newWidth;
    }
  };

  const setContainerRef = (node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    previewContainerRef.current = node;
    if (node) {
      const resizeObserver = new ResizeObserver(() => updatePreviewWidth());
      resizeObserver.observe(node);
      observerRef.current = resizeObserver;
      setTimeout(updatePreviewWidth, 50);
    }
  };

  useEffect(() => {
    const handleWindowResize = () => updatePreviewWidth();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

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
    let ac = formData.baseAc || 10;
    // Add race bonus
    ac += (selectedRace?.ac_bonus || 0);
    // Add armor bonus
    ac += (selectedArmor?.ac_bonus || 0);
    // Add shield
    if (formData.isShielded) ac += 2;
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

    // copy current formData to updated
    const updated = { ...formData, [field]: value };

    // Recalculate weeklyCostGp if level changes 
    if (field === 'level') {
      const newLevel = Math.max(1, value);
      updated.weeklyCostGp = 4 * (newLevel * newLevel);
    }
    setFormData(updated);
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
        setFormData(prev => prev ? { ...prev, formationAvailability: filtered } : null);
      }
    }

    const cap = getMaxTroopForSize(formData.sizeCategory || 100, isMounted);
    updateFormData('troopCount', cap);
  }, [formData?.mountId, getMaxTroopForSize]);

  useEffect(() => {
    if (!formData) return;
    const hero = formData.isHero;
    if (hero) {
      if (!wasHeroChecked) {
        setPreviousHeroBodyCount(formData.troopCount);
        setWasHeroChecked(true);
      }
      if (formData.troopCount !== 1) {
        updateFormData('troopCount', 1);
      }
    } else {
      if (wasHeroChecked) {
        const restoreCount = previousHeroBodyCount > 0 ? previousHeroBodyCount : 1;
        updateFormData('troopCount', restoreCount);
        setWasHeroChecked(false);
      }
    }
  }, [formData?.isHero, formData?.troopCount]);

  useEffect(() => {
    if (!formData) return;
    const isGargantuan = formData.sizeCategory === 400;

    if (isGargantuan) {
      if (!wasAt400) {
        setPreviousHeroState(formData.isHero);
        setPreviousBodyCount(formData.troopCount || 1);
        setWasAt400(true);
      }
      if (!formData.isHero) {
        updateFormData('isHero', true);
      }
      if (formData.troopCount !== 1) {
        updateFormData('troopCount', 1);
      }
    } else {
      if (wasAt400) {
        updateFormData('isHero', previousHeroState);
        updateFormData('troopCount', previousBodyCount);
        setWasAt400(false);
      }
    }

    // Auto-set troop count to max for this size
    const cap = getMaxTroopForSize(formData.sizeCategory || 100, !!formData.mountId);
    updateFormData('troopCount', cap);
  }, [formData?.sizeCategory, getMaxTroopForSize]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: templateData, error: templateError } = await supabase
          .from('unit_templates')
          .select(`
            *,
            races(name, icon_url, base_hd, size_category, visual_scale, can_charge),
            unit_types(name, icon_url),
            armors(name),
            mounts(name)
          `)
          .order('unit_name');

        if (templateError) throw templateError;
        setTemplates((templateData || []).map(mapTemplate));

        const [
          racesRes,
          weaponsRes,
          armorsRes,
          formationsRes,
          unitTypesRes,
          mountsRes,
          sizeCatsRes,
        ] = await Promise.all([
          supabase.from('races').select('*').order('name'),
          supabase.from('weapons').select('*').order('name'),
          supabase.from('armors').select('*').order('name'),
          supabase.from('formations').select('*').order('name'),
          supabase.from('unit_types').select('*').order('name'),
          supabase.from('mounts').select('*').order('name'),
          supabase.from('size_categories').select('*'),
        ]);

        if (racesRes.error) throw racesRes.error;
        if (weaponsRes.error) throw weaponsRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (formationsRes.error) throw formationsRes.error;
        if (unitTypesRes.error) throw unitTypesRes.error;
        if (mountsRes.error) throw mountsRes.error;
        if (sizeCatsRes.error) throw sizeCatsRes.error;

        setRaces(racesRes.data || []);
        setWeaponsLookup(weaponsRes.data || []);
        setArmors(armorsRes.data || []);
        setFormations(formationsRes.data || []);
        setUnitTypes(unitTypesRes.data || []);
        setMounts(mountsRes.data || []);
        setSizeCategories(sizeCatsRes.data || []);

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
    if (selectedId === 'new') {
      return;
    }

    if (selectedId) {
      const found = templates.find(t => t.id === selectedId);
      if (found) {
        setFormData({ ...found });
        setError(null);
        setSuccess(null);
        setWasAt400(found.sizeCategory === 400);
        if (found.sizeCategory === 400) {
          setPreviousHeroState(found.isHero);
          setPreviousBodyCount(found.troopCount);
        }
        if (found.isHero) {
          setWasHeroChecked(true);
          setPreviousHeroBodyCount(found.troopCount > 0 ? found.troopCount : 1);
        } else {
          setWasHeroChecked(false);
        }
      } else {
        setFormData(null);
      }
    } else {
      setFormData(null);
    }
  }, [selectedId, templates]);

  const openAddWeapon = () => {
    setEditingWeaponIndex(null);
    setShowWeaponModal(true);
  };

  const openEditWeapon = (index: number) => {
    setEditingWeaponIndex(index);
    setShowWeaponModal(true);
  };

  const handleWeaponSave = (weapon: WeaponType) => {
    if (!formData) return;
    const currentWeapons = getWeapons();
    let updatedWeapons: WeaponType[];
    if (editingWeaponIndex !== null) {
      updatedWeapons = [...currentWeapons];
      updatedWeapons[editingWeaponIndex] = weapon;
    } else {
      updatedWeapons = [...currentWeapons, weapon];
    }
    const weaponString = stringifyWeapons(updatedWeapons);
    updateFormData('weaponString', weaponString);
    setShowWeaponModal(false);
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
      unitName: 'New Unit',
      raceId: firstRace?.id || '',
      raceName: firstRace?.name || '',
      raceBaseHd: firstRace?.base_hd || 1,
      raceIconUrl: raceIconFromName(firstRace?.name, firstRace?.icon_url),
      raceCanCharge: firstRace?.can_charge || false,
      modelTypeId: firstUnitType?.id || '',
      modelTypeName: firstUnitType?.name || '',
      modelTypeIconUrl: firstUnitType?.icon_url || null,
      unitTypeIconUrl: firstUnitType?.icon_url || null,
      isHero: false,
      troopCount: getMaxTroopForSize(firstRace?.size_category || 100, false),
      level: 1,
      troopHp: firstRace?.base_hd || 10,
      maxUnitHp: (firstRace?.base_hd || 10) * getMaxTroopForSize(firstRace?.size_category || 100, false),
      armorId: '',
      armorName: '',
      isShielded: false,
      baseAc: 10,
      baselineAc: 10,
      weaponString: '',
      mountId: '',
      mountName: '',
      movementPoints: firstRace?.base_speed || 3,
      aggressiveness: 3,
      baseMorale: 3,
      sizeCategory: firstRace?.size_category || 100,
      visualScale: firstRace?.visual_scale || 100,
      formationAvailability: ['Scattered', 'Routed'],
      equipCostGp: 0,
      weeklyCostGp: 4,
      canCharge: firstRace?.can_charge || false,
      ignoreMoraleChecks: false,
      str: 0,
      dex: 0,
      con: 0,
      int: 0,
      wis: 0,
      cha: 0,
      customImageUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleNew = () => {
    const blank = createBlankTemplate();
    setFormData(blank);
    setSelectedId('new');
    setError(null);
    setSuccess(null);
    setWasAt400(blank.sizeCategory === 400);
    if (blank.sizeCategory === 400) {
      setPreviousHeroState(blank.isHero);
      setPreviousBodyCount(blank.troopCount);
    }
    setWasHeroChecked(false);
  };

  const handleClone = () => {
    if (!formData) return;
    setCloneName(`${formData.unitName} (Clone)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const confirmClone = async () => {
    if (!formData) return;
    if (!cloneName.trim()) {
      setCloneError('Name is required');
      return;
    }
    if (templates.some(t => t.unitName === cloneName.trim())) {
      setCloneError('A unit with this name already exists');
      return;
    }
    try {
      const newUnit: UnitTemplate = {
        ...formData,
        id: crypto.randomUUID(),
        unitName: cloneName.trim(),
        equipCostGp: 0,
        weeklyCostGp: 4 * (formData.level * formData.level),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formationAvailability: [...formData.formationAvailability],
        customImageUrl: formData.customImageUrl || null,
        unitTypeIconUrl: formData.unitTypeIconUrl || null,
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
      setSuccess(`Unit "${mapped.unitName}" cloned successfully!`);
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

    if (!formData.unitName.trim()) {
      setError('Unit name is required');
      return;
    }

    const duplicate = templates.find(t => t.unitName === formData.unitName.trim() && t.id !== formData.id);
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

      let ac = formData.baseAc || 10;
      ac += (selectedRace?.ac_bonus || 0);
      ac += (selectedArmor?.ac_bonus || 0);
      if (formData.isShielded) ac += 2;
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
        baselineAc: ac,
        movementPoints: finalMovement,
        equipCostGp: cost || 0,
        weeklyCostGp: 4 * (formData.level * formData.level),
        updatedAt: new Date().toISOString(),
      };

      const rowData = mapTemplateToRow(updatedUnit);

      const existsInDB = templates.some(t => t.id === formData.id);
      let result;

      if (existsInDB) {
        console.log('Updating existing unit:', formData.id);
        const { data, error } = await supabase
          .from('unit_templates')
          .update(rowData)
          .eq('id', formData.id)
          .select();

        if (error) {
          console.error('Update error:', error);
          throw error;
        }
        result = data;
        console.log('Update result:', result);
      } else {
        console.log('Inserting new unit');
        const { id, ...insertData } = rowData;
        const { data, error } = await supabase
          .from('unit_templates')
          .insert(insertData)
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }
        result = data;
        console.log('Insert result:', result);
      }

      if (!result || result.length === 0) {
        console.error('No data returned. result:', result);
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
      setSuccess(`Unit "${mapped.unitName}" saved successfully!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Save error:', err);
      setError(err.message || 'Failed to save unit');
    }
  };

  const handleSaveAs = () => {
    if (!formData) return;
    setCloneName(`${formData.unitName} (Copy)`);
    setCloneError('');
    setShowCloneModal(true);
  };

  const handleDelete = async () => {
    if (!formData) return;
    if (!confirm(`Delete unit "${formData.unitName}"?`)) return;
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

  const effectiveTroopCount = formData ? Math.round((formData.troopCount || 1) * (1 - testCasualtyPercent / 100)) : 0;
  const baseMoraleVal = formData?.baseMorale || 3;
  const effectiveMorale = formData ? Math.max(-baseMoraleVal, Math.min(10 - baseMoraleVal, testMoraleModifier)) : 0;
  const maxUnitHpValue = (formData?.troopHp || 10) * (formData?.troopCount || 1);
  const effectiveUnitHp = formData ? Math.round(maxUnitHpValue * (1 - testCasualtyPercent / 100)) : 0;

  const getSizeLabel = (size: number) => SIZE_LABELS[size] || 'Medium';
  const isGargantuan = formData?.sizeCategory === 400;
  const troopCap = getMaxTroopForSize(formData?.sizeCategory || 100, !!formData?.mountId);

  const filteredMounts = mounts.filter(m => {
    if (!formData) return true;
    if (m.id === formData.mountId) return true;
    return m.size_category > formData.sizeCategory;
  });

  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
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
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search units..."
              value={unitSearchTerm}
              onChange={(e) => setUnitSearchTerm(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {templates
              .filter(t => t.unitName.toLowerCase().includes(unitSearchTerm.toLowerCase()))
              .map(template => {
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
                  <div className="font-medium truncate">{template.unitName}</div>
                  <div className="text-xs text-gray-400">
                    Cost: {template.equipCostGp || 0}gp · {template.raceName || 'No Race'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col bg-[#0d0d1a]">
          {formData ? (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl space-y-4">
                  {/* Two-column compact field block */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {/* LEFT column */}
                    <div className="space-y-3">
                      {/* Identity */}
                      <div className="flex items-end gap-2">
                        <Cell label="Unit Name" widthClass="flex-1">
                          <input
                            type="text"
                            value={formData.unitName || ''}
                            onChange={(e) => updateFormData('unitName', e.target.value)}
                            className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                          />
                        </Cell>
                        <div className="pb-1">
                          <Toggle
                            checked={formData.isHero || false}
                            disabled={isGargantuan}
                            onChange={(v) => { updateFormData('isHero', v); if (v) updateFormData('ignoreMoraleChecks', true); }}
                            label="Hero"
                          />
                        </div>
                      </div>

                      {/* Race & Level */}
                      <div className="flex items-end gap-2">
                        <Cell label="Race" widthClass="flex-1">
                          <select
                            key={`race-${formData.raceId || 'none'}`}
                            value={formData.raceId || ''}
                            onChange={(e) => {
                              const race = races.find(r => r.id === e.target.value);
                              const currentHp = formData?.troopHp || 0;
                              const newHp = (race?.base_hd && (currentHp === 10 || currentHp === 0)) ? race.base_hd : currentHp;

                              let newSize = race?.size_category || 100;
                              if (formData?.mountId) {
                                const mount = mounts.find(m => m.id === formData.mountId);
                                if (mount) {
                                  newSize = Math.max(race?.size_category || 100, mount.size_category);
                                }
                              }

                              setFormData(prev => prev ? {
                                ...prev,
                                raceId: e.target.value,
                                raceName: race?.name || '',
                                raceIconUrl: raceIconFromName(race?.name, race?.icon_url),
                                raceCanCharge: race?.can_charge || false,
                                troopHp: newHp,
                                level: race?.base_hd || 1,
                                movementPoints: race?.base_speed || 3,
                                canCharge: race?.can_charge || false,
                                sizeCategory: newSize,
                                visualScale: race?.visual_scale || 100,
                              } : null);
                            }}
                            className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                          >
                            <option value="">Select a race...</option>
                            {races.map(race => (
                              <option key={race.id} value={race.id}>{race.name}</option>
                            ))}
                          </select>
                        </Cell>
                        <Cell label="Level"><NumInput value={formData.level || 1} min={1} onChange={(v) => updateFormData('level', v || 1)} /></Cell>
                      </div>

                      {/* Token */}
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-0.5">Size: <span className="text-yellow-400">{getSizeLabel(formData.sizeCategory || 100)}</span></label>
                        <input
                          type="range"
                          min="0"
                          max="4"
                          step="1"
                          value={Math.max(0, SIZE_SLIDER_VALUES.indexOf(formData.sizeCategory || 100))}
                          onChange={(e) => updateFormData('sizeCategory', SIZE_SLIDER_VALUES[parseInt(e.target.value)] || 100)}
                          className="w-full accent-yellow-400"
                        />
                        <div className="flex justify-between text-[9px] text-gray-500 px-0.5 mt-0.5">
                          <span>Small</span><span>Med</span><span>Large</span><span>Huge</span><span>Garg</span>
                        </div>
                        <div className="flex items-end gap-2 mt-1">
                          <Cell label="Visual scale" widthClass="flex-1"><NumInput value={formData.visualScale || 100} min={50} max={149} onChange={(v) => updateFormData('visualScale', Math.max(50, Math.min(149, v || 100)))} /></Cell>
                        </div>
                      </div>

                      {/* Hit Points */}
                      <div className="flex items-end gap-2">
                        <Cell label="HP/troop"><NumInput value={formData.troopHp || 10} min={1} onChange={(v) => updateFormData('troopHp', v || 10)} /></Cell>
                        <Cell label="Troop count"><NumInput value={formData.troopCount || 1} min={1} max={troopCap} disabled={isGargantuan || formData.isHero} onChange={(v) => updateFormData('troopCount', Math.min(v || 1, troopCap))} /></Cell>
                        <Cell label="Unit HP"><ReadBox>{(formData.troopHp || 0) * (formData.troopCount || 1)}</ReadBox></Cell>
                      </div>
                      {(isGargantuan || formData.isHero) && (
                        <p className="text-[10px] text-gray-500">Troop count fixed at 1 for Hero/Gargantuan</p>
                      )}
                    </div>
                    {/* RIGHT column */}
                    <div className="space-y-3">

                      {/* Defense */}
                      <div className="space-y-1">
                        <div className="flex items-end gap-2">
                          <Cell label="Base AC"><NumInput value={formData.baseAc || 10} min={1} max={30} onChange={(v) => updateFormData('baseAc', v || 10)} /></Cell>
                          <Cell label="Movement"><NumInput value={formData.movementPoints || 3} min={1} onChange={(v) => updateFormData('movementPoints', Math.max(1, v || 3))} /></Cell>
                        </div>
                        <div className="flex items-end gap-2">
                          <Cell label="Armor" widthClass="flex-1">
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
                              className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                            >
                              <option value="">No Armor</option>
                              {sortedArmors.map(armor => (
                                <option key={armor.id} value={armor.id}>
                                  {armor.name} (+{armor.ac_bonus || 0} AC) - {armor.cost_gp || 0}gp
                                </option>
                              ))}
                            </select>
                          </Cell>
                          <div className="pb-1"><Toggle checked={formData.isShielded || false} onChange={(v) => setFormData(prev => prev ? { ...prev, isShielded: v } : null)} label="Shield" /></div>
                        </div>
                      </div>

                      {/* Mount & Charge */}
                      <div className="flex items-end gap-2">
                        <Cell label="Mount" widthClass="flex-1">
                          <select
                            key={`mount-${formData.mountId || 'none'}`}
                            value={formData.mountId || ''}
                            onChange={(e) => {
                              const selectedValue = e.target.value;
                              const mount = mounts.find(m => m.id === selectedValue);

                              if (mount) {
                                setFormData(prev => prev ? {
                                  ...prev,
                                  mountId: selectedValue,
                                  mountName: mount.name,
                                  sizeCategory: mount.size_category,
                                } : null);
                                const mountedUnitType = unitTypes.find(m => m.isMounted === true);
                                if (mountedUnitType) {
                                  setFormData(prev => prev ? {
                                    ...prev,
                                    modelTypeId: mountedUnitType.id,
                                    modelTypeName: mountedUnitType.name,
                                    unitTypeIconUrl: mountedUnitType.icon_url || null,
                                  } : null);
                                }
                              } else {
                                const race = races.find(r => r.id === formData?.raceId);
                                setFormData(prev => prev ? {
                                  ...prev,
                                  mountId: '',
                                  mountName: '',
                                  sizeCategory: race?.size_category || 100,
                                } : null);
                              }
                            }}
                            className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                          >
                            <option value="">No Mount</option>
                            {filteredMounts.map(mount => (
                              <option key={mount.id} value={mount.id}>
                                {mount.name} (Speed: {mount.speed}) - {mount.cost_gp || 0}gp
                              </option>
                            ))}
                          </select>
                        </Cell>
                        <div className="pb-1"><Toggle checked={formData.canCharge || false} onChange={(v) => updateFormData('canCharge', v)} label="Charge" /></div>
                      </div>
                      {filteredMounts.length === 0 && formData.mountId === '' && (
                        <p className="text-[10px] text-gray-500">No suitable mounts for this size.</p>
                      )}
                      <p className="text-[10px] text-gray-500">
                        Charge: Race {selectedRace?.can_charge ? 'Yes' : 'No'} · Mount {formData.mountId ? mounts.find(m => m.id === formData.mountId)?.can_charge ? 'Yes' : 'No' : 'N/A'}
                      </p>

                      {/* Combat & Morale */}
                      <div className="flex items-end gap-2">
                        <Cell label="Aggress."><NumInput value={formData.aggressiveness || 3} min={1} max={10} disabled={formData.isHero} onChange={(v) => updateFormData('aggressiveness', Math.max(1, Math.min(10, v || 3)))} /></Cell>
                        <Cell label="Base morale"><NumInput value={formData.baseMorale || 3} min={1} max={10} disabled={!!formData.ignoreMoraleChecks} onChange={(v) => updateFormData('baseMorale', Math.max(1, Math.min(10, v || 3)))} /></Cell>
                        <div className="pb-1"><Toggle checked={formData.ignoreMoraleChecks || false} onChange={(v) => updateFormData('ignoreMoraleChecks', v)} label="Fearless" /></div>
                      </div>
                      {formData.isHero && <p className="text-[10px] text-yellow-400/80">Heroes ignore aggressiveness.</p>}

                      {/* Saving throws */}
                      <div className="flex gap-1.5">
                        {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(s => (
                          <Cell key={s} label={s.toUpperCase()} widthClass="w-10"><NumInput value={formData[s] ?? 0} min={-10} max={20} onChange={(v) => updateFormData(s, v)} /></Cell>
                        ))}
                      </div>
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
                      const cost = getWeaponCost(w.name);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded hover:bg-gray-700 transition"
                        >
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="font-medium text-yellow-400">{formatWeaponDisplay(w)}</span>
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

              {/* Unit Type Icons */}
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Unit Type Icon</label>
                <div className="grid grid-cols-7 gap-2 max-h-32 overflow-y-auto p-1 border border-gray-700 rounded bg-gray-800/30">
                  {unitTypes.map((ut) => {
                    const isSelected = formData.modelTypeId === ut.id;
                    return (
                      <div
                        key={ut.id}
                        onClick={() => {
                          setFormData(prev => prev ? {
                            ...prev,
                            modelTypeId: ut.id,
                            modelTypeName: ut.name,
                            unitTypeIconUrl: ut.icon_url || null,
                          } : null);
                          
                          //updateFormData('modelTypeId', ut.id);
                          // updateFormData('modelTypeName', ut.name);
                          // updateFormData('unitTypeIconUrl', ut.icon_url || null);
                        }}
                        className={`border-2 rounded p-1 cursor-pointer transition flex flex-col items-center ${
                          isSelected ? 'border-yellow-400 bg-yellow-400/20' : 'border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {ut.icon_url ? (
                          <NextImage
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
                    <div className="col-span-6 text-sm text-gray-500 text-center py-4">
                      No unit types found in database.
                    </div>
                  )}
                </div>
              </div>

              {/* Formations */}
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Formation Availability</label>
                <div className="flex flex-wrap gap-1">
                  {formations.map(formation => {
                    const isMounted = formData.mountId !== '';
                    const isPhalanxShieldWall = formation.name === 'Phalanx' || formation.name === 'Shield Wall';
                    const disabled = (isMounted && isPhalanxShieldWall) || formation.name === 'Scattered' || isGargantuan;
                    const selected = formData.formationAvailability?.includes(formation.name) || false;
                    return (
                      <label
                        key={formation.id}
                        className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 cursor-pointer border ${
                          selected ? 'bg-amber-900/40 text-amber-200 border-amber-700/60' : 'bg-gray-800 text-gray-300 border-gray-700'
                        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => toggleFormation(formation.name)}
                          className="h-3 w-3 accent-amber-400"
                        />
                        {formation.name}
                        {formation.name === 'Scattered' && <span className="text-gray-500">(always)</span>}
                        {disabled && isMounted && isPhalanxShieldWall && <span className="text-gray-500">(no mount)</span>}
                        {disabled && isGargantuan && formation.name !== 'Scattered' && <span className="text-gray-500">(garg)</span>}
                      </label>
                    );
                  })}
                  <label className="inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border bg-gray-800 text-gray-500 opacity-60">
                    <input type="checkbox" checked disabled className="h-3 w-3 accent-amber-400" />
                    Routed
                    <span className="text-gray-600">(always)</span>
                  </label>
                </div>
              </div>

              {/* Calculated fields summary */}
              <div className="grid grid-cols-4 gap-2 p-2.5 bg-gray-800 rounded border border-gray-700">
                <div>
                  <label className="block text-[10px] text-gray-400">AC</label>
                  <div className="text-lg font-bold text-yellow-400">{calculateAC()}</div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Movement</label>
                  <div className="text-lg font-bold text-yellow-400">{calculateMovement()}</div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Equip Cost (gp)</label>
                  <div className="text-lg font-bold text-yellow-400">{calculateCost()}</div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Weekly Cost (gp)</label>
                  <div className="text-lg font-bold text-yellow-400">{formData.weeklyCostGp || 0}</div>
                </div>
              </div>
                </div>
              </div>
              {/* Sticky Save bar — always visible without scrolling */}
              <div className="flex-none px-6 py-3 border-t border-gray-700 bg-[#0d0d1a] flex gap-3">
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
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-500">
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
                <div
                  ref={setContainerRef}
                  style={{ width: '100%' }}
                  className="flex justify-center items-center"
                >
                  <TokenPreview
                    key={formData?.id + '-' + (formData?.modelTypeId || 'none') + '-' + previewWidth}
                    unitName={formData.unitName || 'Unit'}
                    troopCount={effectiveTroopCount}
                    maxTroopCount={formData.troopCount || 1}
                    currentFormation={testFormation}
                    team={previewTeam}
                    visualScale={formData.visualScale || 100}
                    sizeCategory={formData.sizeCategory || 100}
                    isRouted={testFormation === 'Routed'}
                    currentMorale={effectiveMorale}
                    baseMorale={formData.baseMorale || 3}
                    isHero={formData.isHero || false}
                    raceIconUrl={formData.raceIconUrl || selectedRace?.icon_url || undefined}
                    unitTypeIconUrl={formData.unitTypeIconUrl || selectedUnitType?.icon_url || undefined}
                    customImageUrl={formData.customImageUrl || formData.raceIconUrl || selectedRace?.icon_url || undefined}
                    width={previewWidth}
                    height={previewWidth * 0.75}
                    currentUnitHp={effectiveUnitHp}
                    maxUnitHp={maxUnitHpValue}
                    mountId={formData.mountId || null}
                    sizeCategories={sizeCategories}
                    formations={formations}
                    isCharging={testCharge}
                    onImageClick={openImagePicker}
                  />
                </div>
                <button
                  onClick={openImagePicker}
                  className="mt-2 ml-2 px-3 py-1 bg-blue-600 text-white rounded text-xs"
                >
                  Change Image
                </button>
              </div>

              {/* Team preview */}
              <div className="mt-2 w-full max-w-[200px]">
                <label className="block text-xs text-gray-400 mb-1">Team preview</label>
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
                <label className="block text-xs text-gray-400 mb-1">Morale modifier: {effectiveMorale >= 0 ? '+' : ''}{effectiveMorale}</label>
                <input
                  type="range"
                  min={-(formData?.baseMorale || 3)}
                  max={10 - (formData?.baseMorale || 3)}
                  value={effectiveMorale}
                  onChange={(e) => setTestMoraleModifier(parseInt(e.target.value))}
                  className="w-full accent-yellow-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Formation preview</label>
                <div className="grid grid-cols-2 gap-1">
                  {['Open Order', 'Close Order', 'Scattered', 'Phalanx', 'Shield Wall', 'Routed'].map((f) => (
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
                  <label className="flex items-center gap-1 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      name="testCharge"
                      checked={testCharge}
                      onChange={(e) => setTestCharge(e.target.checked)}
                      className="accent-yellow-400"
                    />
                    Charge
                  </label>
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

      {/* Image Picker Modal (shared) */}
      {showImagePicker && (
        <ImagePickerModal
          current={formData?.customImageUrl}
          uploadKey={formData?.id || 'temp'}
          onSelect={(url) => { updateFormData('customImageUrl', url); setShowImagePicker(false); }}
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* Weapon Modal (shared editor) */}
      {showWeaponModal && (
        <WeaponEditorModal
          initial={editingWeaponIndex !== null ? (getWeapons()[editingWeaponIndex] ?? null) : null}
          title={editingWeaponIndex !== null ? 'Edit Weapon' : 'Add Weapon'}
          onSave={handleWeaponSave}
          onClose={() => setShowWeaponModal(false)}
        />
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