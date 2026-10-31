// src/components/ShipEditor/ShipEditor.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/packages/infra/supabase';
import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  COMPONENT_NAMES,
  DEFAULT_TOTAL_MASS,
  canPlaceWeapon,
  componentByName,
  computeShipBuild,
  weaponFitsSlot,
  weaponTons,
  ShipBuild,
} from '@/packages/ships';
import {
  mapAccessoryRows,
  mapCrewRows,
  mapShipAccessoryRow,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
  mapWeaponRows,
} from '@/packages/ships';
import { ImagePickerModal } from '@/components/ImagePickerModal';
import { ShipLayout } from '@/components/ShipRenderer/ShipLayout';

const MOUNT_SLOTS = ['Fore', 'Left', 'Right', 'Rear', '360', 'Ram'] as const;

function humanize(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function Cell({ label, children, widthClass = 'w-16' }: { label: string; children: React.ReactNode; widthClass?: string }) {
  return (
    <label className={`flex flex-col gap-0.5 text-[10px] text-gray-400 min-w-0 ${widthClass}`}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max, step, disabled }: {
  value: any; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    />
  );
}

function ReadBox({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'warn' | 'red' }) {
  const color =
    tone === 'red' ? 'text-red-400' :
    tone === 'warn' ? 'text-amber-400' :
    'text-yellow-400';
  return (
    <div className={`w-full bg-gray-700 ${color} text-xs rounded px-2 py-1 border border-gray-600`}>
      {children}
    </div>
  );
}

/** A Stat-grid cell: small label over a bold value. */
function StatCell({ label, children, tone = 'default' }: { label: string; children: React.ReactNode; tone?: 'default' | 'warn' | 'red' }) {
  const color =
    tone === 'red' ? 'text-red-400' :
    tone === 'warn' ? 'text-amber-400' :
    'text-yellow-400';
  return (
    <div className="min-w-0">
      <label className="block text-[9px] text-gray-500 truncate">{label}</label>
      <div className={`text-sm font-bold truncate ${color}`}>{children}</div>
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 9, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm leading-none"
      >
        −
      </button>
      <span className="w-5 text-center text-xs text-white">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-6 h-6 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm leading-none"
      >
        +
      </button>
      {label && <span className="text-[10px] text-gray-400 ml-1">{label}</span>}
    </div>
  );
}

// MC = hexes to travel per 60° turn — LOWER is better (tight turn), so the scale
// runs green (1-2) -> yellow (3-4) -> orange (5-7) -> red (8+).
function mcColor(mc: number) {
  if (mc <= 2) return 'bg-green-700 text-white';
  if (mc <= 4) return 'bg-yellow-700 text-white';
  if (mc <= 7) return 'bg-orange-700 text-white';
  return 'bg-red-700 text-white';
}

function buildFromTemplate(
  t: ShipTemplate,
  armors: ShipArmor[],
  components: ShipComponent[],
  accessories: ShipAccessory[],
  weapons: ShipWeapon[],
): ShipBuild | null {
  const armor = armors.find(a => a.id === t.armorId) || armors[0];
  if (!armor) return null;
  return {
    armor,
    components,
    accessoriesCatalog: accessories,
    weaponsCatalog: weapons,
    totalMass: t.totalMass,
    helm: t.helm,
    commandBridge: t.commandBridge,
    sails: t.sails,
    rudders: t.rudders,
    reinforcement: t.reinforcement,
    crewCount: t.crewCount,
    crewQuarters: t.crewQuarters ?? 0,
    passengers: t.passengers ?? 0,
    weaponCapacity: t.weaponCapacity ?? 0,
    atmosphericSpeed: t.atmosphericSpeed ?? 0,
    damageThreshold: t.damageThreshold ?? 15,
    cargoArea: t.cargoArea,
    templateAccessories: t.accessories,
    templateWeapons: t.weapons,
  };
}

export default function ShipEditor({ readOnly = false }: { readOnly?: boolean }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ShipTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const savedSnapshotRef = useRef<string>('');
  const pendingActionRef = useRef<(() => void) | null>(null);

  const [armors, setArmors] = useState<ShipArmor[]>([]);
  const [components, setComponents] = useState<ShipComponent[]>([]);
  const [accessories, setAccessories] = useState<ShipAccessory[]>([]);
  const [weaponsCatalog, setWeaponsCatalog] = useState<ShipWeapon[]>([]);

  const [formData, setFormData] = useState<ShipTemplate | null>(null);

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  // Performance box: formula text is hidden behind the [formulas] button.
  const [showFormula, setShowFormula] = useState(false);
  // Accessory catalog picker modal.
  const [showAccessoriesModal, setShowAccessoriesModal] = useState(false);
  // Ship image picker.
  const [showImagePicker, setShowImagePicker] = useState(false);
  // Crew roster modal.
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [editingCrewIndex, setEditingCrewIndex] = useState<number | null>(null);
  const [crewDraft, setCrewDraft] = useState<{ count: number; name: string; level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; cost: number | null }>({
    count: 1, name: '', level: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cost: null,
  });

  const build = formData
    ? buildFromTemplate(formData, armors, components, accessories, weaponsCatalog)
    : null;
  const stats = build ? computeShipBuild(build) : null;

  const isDirty = !!formData && JSON.stringify(formData) !== savedSnapshotRef.current;

  const requestAction = (action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
    } else {
      action();
    }
  };

  const handleUnsavedSave = async () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
    const ok = await handleSave();
    if (ok && action) action();
  };
  const handleUnsavedDiscard = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
    if (action) action();
  };
  const handleUnsavedCancel = () => {
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
  };

  const updateFormData = useCallback((field: keyof ShipTemplate, value: any) => {
    if (readOnly) return;
    setFormData(prev => (prev ? { ...prev, [field]: value } : prev));
  }, [readOnly]);

  const accessoryCount = (id: string): number =>
    formData?.accessories.find(a => a.accessoryId === id)?.count || 0;

  const setAccessoryCount = (id: string, count: number) => {
    if (!formData) return;
    const existing = formData.accessories.find(a => a.accessoryId === id);
    const next = count <= 0
      ? formData.accessories.filter(a => a.accessoryId !== id)
      : existing
        ? formData.accessories.map(a => (a.accessoryId === id ? { ...a, count } : a))
        : [...formData.accessories, { accessoryId: id, count }];
    updateFormData('accessories', next);
  };

  const setWeaponRow = (index: number, field: 'weaponId' | 'mountSlot' | 'count', value: any) => {
    if (!formData) return;
    const weapons = formData.weapons.map((w, i) => (i === index ? { ...w, [field]: value } : w));
    updateFormData('weapons', weapons);
  };

  const addWeapon = (slot: string = 'Fore') => {
    if (!formData || weaponsCatalog.length === 0) return;
    const capacity = stats?.weaponCapacity ?? 0;
    const placed = stats?.weaponPlacedTons ?? 0;
    const candidate = weaponsCatalog.find(
      w => weaponFitsSlot(w, slot) && canPlaceWeapon(placed, capacity, weaponTons(w)),
    );
    if (!candidate) {
      setError(slot === 'Ram'
        ? 'No melee-range weapon (max range 1) fits the remaining weapon capacity.'
        : 'No weapon capacity left. Increase the Weapon capacity row first.');
      return;
    }
    setError(null);
    updateFormData('weapons', [...formData.weapons, {
      weaponId: candidate.id,
      mountSlot: slot,
      count: 1,
    }]);
  };

  const removeWeaponRow = (index: number) => {
    if (!formData) return;
    updateFormData('weapons', formData.weapons.filter((_, i) => i !== index));
  };

  const openAddCrew = () => {
    if (readOnly) return;
    setEditingCrewIndex(null);
    setCrewDraft({ count: 1, name: '', level: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cost: null });
    setShowCrewModal(true);
  };

  const openEditCrew = (index: number) => {
    if (readOnly) return;
    const c = formData?.crews[index];
    if (!c) return;
    setEditingCrewIndex(index);
    setCrewDraft({ count: 1, name: c.name || '', level: c.level, str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha, cost: c.cost });
    setShowCrewModal(true);
  };

  const confirmCrew = () => {
    if (!formData) return;
    const { count, name, level, str, dex, con, int, wis, cha, cost } = crewDraft;
    const maxAdd = Math.max(0, formData.crewCount - formData.crews.length);
    const n = Math.min(Math.max(1, Math.floor(count) || 1), editingCrewIndex !== null ? 1 : Math.max(1, maxAdd));
    const rows: ShipCrew[] = Array.from({ length: n }, () => ({
      id: crypto.randomUUID(),
      name: name.trim() ? name.trim() : null,
      level, str, dex, con, int, wis, cha, cost,
    }));
    if (editingCrewIndex !== null) {
      const crews = [...formData.crews];
      crews[editingCrewIndex] = rows[0];
      updateFormData('crews', crews);
    } else {
      updateFormData('crews', [...formData.crews, ...rows]);
    }
    setShowCrewModal(false);
    setEditingCrewIndex(null);
  };

  const removeCrew = (index: number) => {
    if (!formData) return;
    updateFormData('crews', formData.crews.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Flat queries + client-side join merge: avoids depending on PostgREST resolving
        // the ship_template_* relationships (a schema-cache hiccup would otherwise blank
        // the whole list).
        const [templatesRes, armorsRes, componentsRes, accessoriesRes, weaponsRes, templateAccessoriesRes, templateWeaponsRes, crewsRes] = await Promise.all([
          supabase.from('ship_templates').select('*').order('name'),
          supabase.from('ship_armors').select('*').order('id'),
          supabase.from('ship_components').select('*').order('id'),
          supabase.from('ship_accessories').select('*').order('id'),
          supabase.from('ship_weapons').select('*').order('id'),
          supabase.from('ship_template_accessories').select('*'),
          supabase.from('ship_template_weapons').select('*'),
          supabase.from('ship_crews').select('*'),
        ]);
        if (templatesRes.error) throw templatesRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (componentsRes.error) throw componentsRes.error;
        if (accessoriesRes.error) throw accessoriesRes.error;
        if (weaponsRes.error) throw weaponsRes.error;
        if (templateAccessoriesRes.error) throw templateAccessoriesRes.error;
        if (templateWeaponsRes.error) throw templateWeaponsRes.error;
        if (crewsRes.error) throw crewsRes.error;

        const accessoriesByTemplate = new Map<string, any[]>();
        for (const row of templateAccessoriesRes.data || []) {
          const list = accessoriesByTemplate.get(row.template_id) || [];
          list.push(row);
          accessoriesByTemplate.set(row.template_id, list);
        }
        const weaponsByTemplate = new Map<string, any[]>();
        for (const row of templateWeaponsRes.data || []) {
          const list = weaponsByTemplate.get(row.template_id) || [];
          list.push(row);
          weaponsByTemplate.set(row.template_id, list);
        }
        const crewsByTemplate = new Map<string, any[]>();
        for (const row of crewsRes.data || []) {
          const list = crewsByTemplate.get(row.template_id) || [];
          list.push(row);
          crewsByTemplate.set(row.template_id, list);
        }

        setTemplates((templatesRes.data || []).map(row => mapShipTemplateRow({
          ...row,
          ship_template_accessories: accessoriesByTemplate.get(row.id) || [],
          ship_template_weapons: weaponsByTemplate.get(row.id) || [],
          ship_crews: crewsByTemplate.get(row.id) || [],
        })));
        setArmors((armorsRes.data || []).map(mapShipArmorRow));
        setComponents((componentsRes.data || []).map(mapShipComponentRow));
        setAccessories((accessoriesRes.data || []).map(mapShipAccessoryRow));
        setWeaponsCatalog((weaponsRes.data || []).map(mapShipWeaponRow));
        setLoading(false);
      } catch (err: any) {
        console.error('Ship editor fetch error:', err);
        setError(err.message || 'Failed to load ship data');
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedId === 'new') return;
    if (selectedId) {
      const found = templates.find(t => t.id === selectedId);
      if (found) {
        setFormData({ ...found });
        savedSnapshotRef.current = JSON.stringify(found);
        setError(null);
        setSuccess(null);
      } else {
        setFormData(null);
      }
    } else {
      setFormData(null);
    }
  }, [selectedId, templates]);

  // Warn when leaving the page with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const createBlankTemplate = (): ShipTemplate => {
    const firstArmor = armors.find(a => a.name === 'wood') || armors[0];
    return {
      id: crypto.randomUUID(),
      name: 'New Ship',
      role: '',
      armorId: firstArmor?.id || '',
      totalMass: DEFAULT_TOTAL_MASS,
      helm: 1,
      commandBridge: 0,
      sails: 0,
      rudders: 0,
      reinforcement: 0,
      crewCount: 0,
      crewQuarters: 0,
      passengers: 0,
      weaponCapacity: 0,
      atmosphericSpeed: 0,
      damageThreshold: 15,
      imageUrl: '',
      cargoArea: 0,
      accessories: [],
      weapons: [],
      crews: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const handleNew = () => {
    if (readOnly) return;
    requestAction(() => {
      const blank = createBlankTemplate();
      setFormData(blank);
      savedSnapshotRef.current = JSON.stringify(blank);
      setSelectedId('new');
      setError(null);
      setSuccess(null);
    });
  };

  const handleClone = () => {
    if (readOnly) return;
    requestAction(() => {
      if (!formData) return;
      setCloneName(`${formData.name} (Clone)`);
      setCloneError('');
      setShowCloneModal(true);
    });
  };

  const confirmClone = async () => {
    if (!formData) return;
    if (!cloneName.trim()) {
      setCloneError('Name is required');
      return;
    }
    if (templates.some(t => t.name === cloneName.trim())) {
      setCloneError('A ship with this name already exists');
      return;
    }
    try {
      const newShip: ShipTemplate = {
        ...formData,
        id: crypto.randomUUID(),
        name: cloneName.trim(),
        accessories: formData.accessories.map(a => ({ ...a })),
        weapons: formData.weapons.map(w => ({ ...w })),
        crews: formData.crews.map(c => ({ ...c, id: crypto.randomUUID() })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('ship_templates')
        .insert(mapShipTemplateToRow(newShip))
        .select('id')
        .single();
      if (error) throw error;
      const accRows = mapAccessoryRows(newShip);
      if (accRows.length) {
        const { error: accErr } = await supabase.from('ship_template_accessories').insert(accRows);
        if (accErr) throw accErr;
      }
      const wpnRows = mapWeaponRows(newShip);
      if (wpnRows.length) {
        const { error: wpnErr } = await supabase.from('ship_template_weapons').insert(wpnRows);
        if (wpnErr) throw wpnErr;
      }
      const crewRows = mapCrewRows(newShip);
      if (crewRows.length) {
        const { error: crewErr } = await supabase.from('ship_crews').insert(crewRows);
        if (crewErr) throw crewErr;
      }
      const { data: fresh } = await supabase
        .from('ship_templates')
        .select('*, ship_template_accessories(*), ship_template_weapons(*), ship_crews(*)')
        .eq('id', data.id)
        .single();
      const mapped = mapShipTemplateRow(fresh);
      setTemplates(prev => [...prev, mapped]);
      setSelectedId(mapped.id);
      setFormData(mapped);
      savedSnapshotRef.current = JSON.stringify(mapped);
      setShowCloneModal(false);
      setCloneName('');
      setSuccess(`Ship "${mapped.name}" cloned successfully!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setCloneError(err.message || 'Failed to clone ship');
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (readOnly) return false;
    if (!formData) {
      setError('No ship selected to save');
      return false;
    }
    if (!formData.name.trim()) {
      setError('Ship name is required');
      return false;
    }
    const duplicate = templates.find(t => t.name === formData.name.trim() && t.id !== formData.id);
    if (duplicate) {
      setError('A ship with this name already exists');
      return false;
    }

    try {
      const existsInDB = templates.some(t => t.id === formData.id);
      let id = formData.id;
      if (existsInDB) {
        const { error } = await supabase
          .from('ship_templates')
          .update(mapShipTemplateToRow(formData))
          .eq('id', formData.id)
          .select('id')
          .single();
        if (error) throw error;
      } else {
        const { id: _id, ...insertData } = mapShipTemplateToRow(formData);
        const { data, error } = await supabase
          .from('ship_templates')
          .insert(insertData)
          .select('id')
          .single();
        if (error) throw error;
        id = data.id;
      }

      const withId = { ...formData, id };
      await supabase.from('ship_template_accessories').delete().eq('template_id', id);
      const accRows = mapAccessoryRows(withId);
      if (accRows.length) {
        const { error } = await supabase.from('ship_template_accessories').insert(accRows);
        if (error) throw error;
      }
      await supabase.from('ship_template_weapons').delete().eq('template_id', id);
      const wpnRows = mapWeaponRows(withId);
      if (wpnRows.length) {
        const { error } = await supabase.from('ship_template_weapons').insert(wpnRows);
        if (error) throw error;
      }
      await supabase.from('ship_crews').delete().eq('template_id', id);
      const crewRows = mapCrewRows(withId);
      if (crewRows.length) {
        const { error } = await supabase.from('ship_crews').insert(crewRows);
        if (error) throw error;
      }

      const { data: fresh } = await supabase
        .from('ship_templates')
        .select('*, ship_template_accessories(*), ship_template_weapons(*), ship_crews(*)')
        .eq('id', id)
        .single();
      if (!fresh) throw new Error('No data returned from save operation');
      const mapped = mapShipTemplateRow(fresh);

      setTemplates(prev => {
        const idx = prev.findIndex(t => t.id === id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = mapped;
          return copy;
        }
        return [...prev, mapped];
      });
      setSelectedId(id);
      setFormData(mapped);
      savedSnapshotRef.current = JSON.stringify(mapped);
      setError(null);
      setSuccess(`Ship "${mapped.name}" saved successfully!`);
      setTimeout(() => setSuccess(null), 3000);
      return true;
    } catch (err: any) {
      console.error('Ship save error:', err);
      setError(err.message || 'Failed to save ship');
      return false;
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!formData) return;
    if (!confirm(`Delete ship "${formData.name}"?`)) return;
    try {
      const { error } = await supabase
        .from('ship_templates')
        .delete()
        .eq('id', formData.id);
      if (error) throw error;
      setTemplates(prev => prev.filter(t => t.id !== formData.id));
      setSelectedId(null);
      setFormData(null);
      savedSnapshotRef.current = '';
      setSuccess('Ship deleted successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete ship');
    }
  };

  if (loading) {
    return (
      <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
        Loading Archfar's Shipyard...
      </div>
    );
  }

  const selectedArmor = formData ? armors.find(a => a.id === formData.armorId) : null;
  const remainingMass = stats?.remainingMass ?? 0;
  const cargoCapacity = formData
    ? Math.max(formData.cargoArea, Math.floor(remainingMass + formData.cargoArea))
    : 0;
  const cargoClamped = formData ? Math.max(0, Math.min(formData.cargoArea, cargoCapacity)) : 0;
  const massOverload = stats?.overload ?? false;
  const weaponPlaced = stats?.weaponPlacedTons ?? 0;
  const weaponCapacity = stats?.weaponCapacity ?? 0;
  const weaponOverCapacity = weaponPlaced > weaponCapacity;
  const canAddWeapon = !!formData && weaponsCatalog.some(w => canPlaceWeapon(weaponPlaced, weaponCapacity, weaponTons(w)));
  // Roster is capped at the crew complement set in the Components box.
  const crewSlotsRemaining = formData ? Math.max(0, formData.crewCount - formData.crews.length) : 0;
  const isNew = !!formData && !templates.some(t => t.id === formData.id);
  const mcLabel = (v: number) => (Number.isFinite(v) ? `${v}` : '—');
  const armorName = (id: string) => {
    const armor = armors.find(a => a.id === id);
    return armor ? humanize(armor.name) : '—';
  };
  const weaponCapacityComponent = formData
    ? componentByName(components, COMPONENT_NAMES.weaponCapacity)
    : null;


  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-[#0d0d1a]">
        <h1 className="text-2xl font-bold text-white">Archfar's Shipyard</h1>
        <div className="flex items-center gap-3">
          {readOnly && (
            <span className="px-3 py-1 rounded bg-gray-700 border border-gray-600 text-xs text-gray-300">
              Read-only view — building requires an admin
            </span>
          )}
          <button
            onClick={() => requestAction(() => router.push('/'))}
            className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
          >
            Main Menu
          </button>
        </div>
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
        {/* Left — template picker */}
        <div className="w-1/4 max-w-[256px] flex-shrink-0 p-4 border-r border-gray-700 flex flex-col bg-[#0d0d1a]">
          <div className="flex gap-2 mb-4">
            {!readOnly && (
              <>
                <button
                  onClick={handleNew}
                  className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                >
                  New
                </button>
              </>
            )}
          </div>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search ships..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {templates
              .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(template => {
                const isSelected = template.id === selectedId;
                return (
                  <div
                    key={template.id}
                    onClick={() => requestAction(() => setSelectedId(template.id))}
                    className={`px-3 py-2 rounded cursor-pointer transition border ${
                      isSelected
                        ? 'bg-yellow-500/20 border-yellow-400'
                        : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-medium truncate">{template.name}</div>
                    <div className="text-xs text-gray-400">
                      {template.totalMass}t · {armorName(template.armorId)}
                    </div>
                  </div>
                );
              })}
            {templates.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                No ships found. Create one with "New".
              </div>
            )}
          </div>
        </div>

                {/* Middle — builder */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0d0d1a]">
          {formData ? (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                <fieldset disabled={readOnly} className="max-w-4xl space-y-4">
                  {/* Identity + mass */}
                  <div className="flex items-end gap-2">
                    <Cell label="Ship Name" widthClass="flex-1">
                      <input
                        type="text"
                        value={formData.name || ''}
                        onChange={(e) => updateFormData('name', e.target.value)}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      />
                    </Cell>
                    <Cell label="Role" widthClass="flex-1">
                      <input
                        type="text"
                        value={formData.role || ''}
                        placeholder="e.g. Shuttle, Scout, Heavy Melee"
                        onChange={(e) => updateFormData('role', e.target.value)}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      />
                    </Cell>
                    <Cell label="Total mass (ton)" widthClass="w-32">
                      <NumInput
                        value={formData.totalMass}
                        min={1}
                        max={500}
                        onChange={(v) => updateFormData('totalMass', Math.max(1, Math.floor(v)))}
                      />
                    </Cell>
                  </div>

                  {/* Authored parameters */}
                  <div className="flex items-end gap-2">
                    <Cell label="Atmospheric speed (0–12)" widthClass="w-44">
                      <NumInput
                        value={formData.atmosphericSpeed}
                        min={0}
                        max={12}
                        onChange={(v) => updateFormData('atmosphericSpeed', Math.max(0, Math.min(12, Math.floor(v))))}
                      />
                    </Cell>
                    <Cell label="Damage threshold" widthClass="w-32">
                      <NumInput
                        value={formData.damageThreshold}
                        min={0}
                        max={999}
                        onChange={(v) => updateFormData('damageThreshold', Math.max(0, Math.floor(v)))}
                      />
                    </Cell>
                  </div>

                  {/* Summary */}
                  {stats && build && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <div className="grid grid-cols-4 gap-2">
                        <StatCell label="Armor">
                          {armorName(formData.armorId)} · AC {stats.ac}
                        </StatCell>
                        <StatCell label="HP">{stats.shipHp}</StatCell>
                        <StatCell label="Damage threshold">{stats.damageThreshold}</StatCell>
                        <StatCell label="Atmospheric speed">{stats.atmosphericSpeed}</StatCell>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-2">
                        <StatCell label="Wild-space acceleration">{stats.accel}</StatCell>
                        <StatCell label="MC (base)">{mcLabel(stats.mcRaw)}</StatCell>
                        <StatCell label="Cargo">{cargoClamped}t</StatCell>
                        <StatCell label="Cost">{stats.buildCost.toLocaleString()}gp</StatCell>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-2">
                        <StatCell label="Min crew / capacity">{stats.minCrew} / {stats.crewCapacity}</StatCell>
                        <StatCell label="Used / total" tone={massOverload ? 'red' : 'default'}>
                          {stats.usedMass} / {stats.totalMass}t
                        </StatCell>
                        <StatCell label="Remaining mass" tone={massOverload ? 'red' : 'default'}>
                          {stats.remainingMass}t
                        </StatCell>
                        <StatCell label="Weapon capacity" tone={weaponOverCapacity ? 'red' : 'default'}>
                          {stats.weaponPlacedTons} / {stats.weaponCapacity}t
                        </StatCell>
                      </div>

                      <div className="mt-2 pt-2 border-t border-gray-700 flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] text-gray-500">MC</span>
                        {stats.mcBands.map(band => (
                          <span key={band.label} className="text-[9px] text-gray-400">
                            {band.label}:{' '}
                            <span className={`px-1 rounded ${Number.isFinite(band.mc) ? mcColor(band.mc) : 'bg-gray-700 text-gray-400'}`}>
                              {mcLabel(band.mc)}
                            </span>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => setShowFormula(v => !v)}
                          className="ml-auto px-2 py-0.5 text-[10px] bg-gray-700 border border-gray-600 text-gray-300 rounded hover:bg-gray-600"
                        >
                          {showFormula ? 'hide formulas' : 'formulas'}
                        </button>
                      </div>

                      {showFormula && (
                        <div className="text-[9px] font-mono text-gray-500 mt-2 leading-relaxed overflow-x-auto">
                          <div>Hull mass = totalMass × (10% + totalMass / 500) = {stats.totalMass} × (0.10 + {stats.totalMass}/500) = {stats.hullMassExact.toFixed(2)}t → {stats.hullMass}t</div>
                          <div>Armor mass = totalMass × armor% = {stats.totalMass} × {(selectedArmor?.massPct ?? 0) * 100}% = {stats.armorMassExact.toFixed(2)}t → {stats.armorMass}t</div>
                          <div>Weapon capacity counts toward ship mass; placed weapons must fit inside it.</div>
                          <div>Acceleration = (sails + rudders) / totalMass × 15 = ({formData.sails} + {formData.rudders}) / {stats.totalMass} × 15 = {stats.accel}</div>
                          <div>MC: x = rudders × 10 / totalMass = {formData.rudders} × 10 / {stats.totalMass} = {((formData.rudders * 10) / Math.max(1, stats.totalMass)).toFixed(3)} → {mcLabel(stats.mcRaw)}</div>
                          <div>effectiveMC = MC − 1 (speed 0–2) · MC (3–7) · MC + 1 (8–12), floored at 0</div>
                          <div>HP = (totalMass × 3 + 40) × armor HP multiplier = ({stats.totalMass} × 3 + 40) × {selectedArmor?.hpMult ?? 1} = {stats.shipHp}</div>
                          <div>Atmospheric speed and damage threshold are authored values.</div>
                        </div>
                      )}

                      {massOverload && (
                        <p className="text-[10px] text-red-400 mt-2">
                          Over the designated mass by {Math.abs(stats.remainingMass)}t — remove fittings or raise total mass.
                        </p>
                      )}
                      {formData.crewCount < stats.minCrew && (
                        <p className="text-[10px] text-amber-400 mt-1">
                          Below minimum crew ({stats.minCrew}) — the ship cannot operate all stations.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Composition */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700 overflow-x-auto">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] text-gray-400">Ship composition</label>
                      <button
                        type="button"
                        onClick={() => setShowAccessoriesModal(true)}
                        className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                      >
                        + Add component
                      </button>
                    </div>

                                        <table className="w-full min-w-[720px] table-fixed text-[11px]">
                      <colgroup>
                        <col className="w-[26%]" />
                        <col className="w-[88px]" />
                        <col className="w-[80px]" />
                        <col className="w-[80px]" />
                        <col />
                        <col className="w-[80px]" />
                      </colgroup>
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="text-left py-1 pr-2 font-normal">Component</th>
                          <th className="text-center py-1 px-2 font-normal">Input</th>
                          <th className="text-right py-1 px-2 font-normal">Mass (ton)</th>
                          <th className="text-right py-1 px-2 font-normal">Crew req.</th>
                          <th className="text-left py-1 pl-2 font-normal">Notes</th>
                          <th className="text-right py-1 pl-2 font-normal">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Hull</td>
                          <td className="text-center px-2 text-gray-500">—</td>
                          <td className="text-right px-2">{stats?.massBreakdown.hull ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">Read-only mass · safe</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Helm</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.helm} min={0} max={9} onChange={(v) => updateFormData('helm', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.helm ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.helm * 1)}</td>
                          <td className="pl-2 text-gray-500">1t each · 1 crew</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Command bridge</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.commandBridge} min={0} max={2} onChange={(v) => updateFormData('commandBridge', Math.max(0, Math.min(2, Math.floor(v))))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.commandBridge ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.commandBridge * 5)}</td>
                          <td className="pl-2 text-gray-500">3t each · 5 crew · +5 command</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Sail</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.sails} min={0} max={99} onChange={(v) => updateFormData('sails', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.sails ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.sails * 0.5)}</td>
                          <td className="pl-2 text-gray-500">1t each · ½ crew</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Rudder vane</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.rudders} min={0} max={99} onChange={(v) => updateFormData('rudders', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.rudders ?? 0}</td>
                          <td className="text-right px-2">{Math.ceil(formData.rudders * 0.5)}</td>
                          <td className="pl-2 text-gray-500">1.5t each (rounded) · ½ crew</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Weapon capacity</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.weaponCapacity} min={0} max={999} onChange={(v) => updateFormData('weaponCapacity', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.weaponCapacity ?? 0}</td>
                          <td className="text-right px-2 text-gray-500">—</td>
                          <td className={`pl-2 ${weaponOverCapacity ? 'text-red-400' : 'text-gray-500'}`}>
                            {weaponCapacityComponent?.effect ? `${weaponCapacityComponent.effect} · ` : ''}
                            Placed {stats?.weaponPlacedTons ?? 0}t / {stats?.weaponCapacity ?? 0}t · crew from chosen weapons
                          </td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Armor</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-[76px]">
                              <select
                                value={formData.armorId || ''}
                                onChange={(e) => updateFormData('armorId', e.target.value)}
                                className="w-full bg-gray-700 text-white text-[10px] rounded px-1 py-0.5 border border-gray-600"
                              >
                                {armors.map(armor => (
                                  <option key={armor.id} value={armor.id}>
                                    {humanize(armor.name)} (AC {armor.ac})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.armor ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">
                            {Math.round((selectedArmor?.massPct ?? 0) * 100)}% mass · AC {selectedArmor?.ac ?? '—'} · HP ×{selectedArmor?.hpMult ?? 1}
                          </td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Reinforcement</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.reinforcement} min={0} max={99} onChange={(v) => updateFormData('reinforcement', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.reinforcement ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">1t each · +10 temp HP (target later)</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Crew quarter</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput value={formData.crewQuarters} min={0} max={99} onChange={(v) => updateFormData('crewQuarters', Math.max(0, Math.floor(v)))} />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.crewQuarters ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">1t each · {stats?.crewCapacity ?? 0} capacity</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        <tr className="border-b border-gray-700/50">
                          <td className="py-1 pr-2">Cargo</td>
                          <td className="text-center px-2">
                            <div className="mx-auto w-16">
                              <NumInput
                                value={formData.cargoArea}
                                min={0}
                                max={Math.max(0, cargoCapacity)}
                                onChange={(v) => updateFormData('cargoArea', Math.max(0, Math.min(Math.floor(v), cargoCapacity)))}
                              />
                            </div>
                          </td>
                          <td className="text-right px-2">{stats?.massBreakdown.cargo ?? 0}</td>
                          <td className="text-right px-2">0</td>
                          <td className="pl-2 text-gray-500">Max {cargoCapacity}t</td>
                          <td className="text-right pl-2 text-gray-500">—</td>
                        </tr>

                        {formData.accessories.map((a) => {
                          const acc = accessories.find(x => x.id === a.accessoryId);
                          if (!acc) return null;
                          return (
                            <tr key={a.accessoryId} className="border-b border-gray-700/50">
                              <td className="py-1 pr-2">
                                <span className="truncate">{humanize(acc.id)}</span>
                              </td>
                              <td className="text-center px-2">
                                <div className="mx-auto w-fit">
                                  <Stepper value={a.count} onChange={(v) => setAccessoryCount(acc.id, v)} max={3} />
                                </div>
                              </td>
                              <td className="text-right px-2">{Math.round((acc.mass || 0) * a.count)}</td>
                              <td className="text-right px-2">{Math.ceil((acc.crew || 0) * a.count)}</td>
                              <td className="pl-2 text-gray-500">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{acc.effect || `${acc.mass}t each`}</span>
                                  <button
                                    type="button"
                                    onClick={() => setAccessoryCount(acc.id, 0)}
                                    className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white flex-none"
                                  >
                                    ×
                                  </button>
                                </div>
                              </td>
                              <td className="text-right pl-2 text-gray-500">—</td>
                            </tr>
                          );
                        })}

                        <tr className="border-t border-gray-600 text-gray-300">
                          <td className="py-1.5 pr-2 font-semibold">Total</td>
                          <td className="text-center px-2 text-gray-500">—</td>
                          <td className="text-right px-2 font-semibold">{stats?.usedMass ?? 0} / {stats?.totalMass ?? 0}t</td>
                          <td className="text-right px-2 font-semibold">{stats?.minCrew ?? 0}</td>
                          <td className="pl-2 text-gray-500">Remaining {stats?.remainingMass ?? 0}t</td>
                          <td className="text-right pl-2 font-semibold text-gray-300">{stats?.buildCost.toLocaleString() ?? 0}gp</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              </div>

              {/* Sticky Save bar */}
              {!readOnly && (
                <div className="flex-none px-6 py-3 border-t border-gray-700 bg-[#0d0d1a] flex gap-3">
                  <button
                    onClick={handleSave}
                    className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                  >
                    {isNew ? 'Create' : 'Save'}
                  </button>
                  <button
                    onClick={handleClone}
                    disabled={!formData}
                    className="px-6 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clone
                  </button>
                  {!isNew && (
                    <button
                      onClick={handleDelete}
                      className="px-6 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-500">
              Select a ship from the list or create a new one
            </div>
          )}
        </div>

        {/* Right — ship image, layout, weapons, roster */}
        <div className="flex-[0_0_34%] min-w-[320px] max-w-[44%] p-4 border-l border-gray-700 bg-[#0d0d1a] overflow-y-auto">
          {formData && build && stats ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] text-gray-400">Ship image</label>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(true)}
                      className="px-2 py-0.5 text-[10px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700"
                    >
                      {formData.imageUrl ? 'Change image' : 'Upload image'}
                    </button>
                  )}
                </div>
                <div className="aspect-video rounded-xl border border-gray-700 bg-gray-900 flex items-center justify-center overflow-hidden">
                  {formData.imageUrl ? (
                    <img src={formData.imageUrl} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-gray-600">No ship image</span>
                  )}
                </div>
              </div>

              <ShipLayout
                build={build}
                stats={stats}
                onAddWeapon={readOnly ? undefined : addWeapon}
                onAddComponent={readOnly ? undefined : () => setShowAccessoriesModal(true)}
              />

              <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] text-gray-400">
                    Weapons — placed {stats.weaponPlacedTons} / {stats.weaponCapacity}t
                  </label>
                  <button
                    type="button"
                    onClick={() => addWeapon('Fore')}
                    disabled={readOnly || !canAddWeapon}
                    className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add weapon
                  </button>
                </div>

                {weaponOverCapacity && (
                  <p className="text-[10px] text-red-400 mb-2">
                    Placed weapons exceed the allocated capacity. Raise Weapon capacity or remove a weapon.
                  </p>
                )}

                {formData.weapons.length === 0 ? (
                  <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                    No weapons mounted.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {formData.weapons.map((w, idx) => {
                      const wpn = weaponsCatalog.find(x => x.id === w.weaponId);
                      const tons = wpn ? weaponTons(wpn) : 0;
                      return (
                        <div key={`${w.weaponId}-${idx}`} className="bg-gray-900/40 rounded p-1.5 space-y-1">
                          <div className="flex items-center gap-1">
                            <select
                              value={w.weaponId}
                              onChange={(e) => setWeaponRow(idx, 'weaponId', e.target.value)}
                              className="flex-1 min-w-0 bg-gray-700 text-white text-[10px] rounded px-1.5 py-1 border border-gray-600"
                            >
                              {weaponsCatalog
                                .filter(weap => weaponFitsSlot(weap, w.mountSlot) || weap.id === w.weaponId)
                                .map(weap => (
                                  <option key={weap.id} value={weap.id}>
                                    {humanize(weap.name)} — {weap.damage} ({weap.mass}t, crew {weap.crew}, every {weap.fireCycleStep} step{weap.fireCycleStep === 1 ? '' : 's'})
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeWeaponRow(idx)}
                              className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white flex-none"
                            >
                              ×
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <select
                              value={w.mountSlot}
                              onChange={(e) => setWeaponRow(idx, 'mountSlot', e.target.value)}
                              className="w-20 bg-gray-700 text-white text-[10px] rounded px-1.5 py-1 border border-gray-600"
                            >
                              {MOUNT_SLOTS.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
                              ))}
                            </select>
                            <div className="w-14 flex-none">
                              <NumInput
                                value={w.count}
                                min={1}
                                max={99}
                                onChange={(v) => setWeaponRow(idx, 'count', Math.max(1, Math.floor(v)))}
                              />
                            </div>
                            <span className="text-[9px] text-gray-400 ml-auto">
                              {tons * w.count}t · {Math.ceil((wpn?.crew || 0) * w.count)} crew
                            </span>
                          </div>
                          {wpn && !weaponFitsSlot(wpn, w.mountSlot) && (
                            <p className="text-[9px] text-amber-400">
                              Ram slots accept only max-range-1 weapons. Change the slot or pick another weapon.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[9px] text-gray-500 mt-1">
                  Weapon crew: {stats.weaponCrew}. Crew comes from the chosen weapons.
                </p>
              </div>

              <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] text-gray-400">
                    Ship roster ({formData.crews.length} / {formData.crewCount})
                  </label>
                  <button
                    type="button"
                    onClick={openAddCrew}
                    disabled={readOnly || crewSlotsRemaining === 0}
                    className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add crew
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <Cell label="Crew on board" widthClass="w-full">
                    <NumInput
                      value={formData.crewCount}
                      min={0}
                      max={999}
                      onChange={(v) => updateFormData('crewCount', Math.max(0, Math.floor(v)))}
                    />
                  </Cell>
                  <Cell label="Passengers" widthClass="w-full">
                    <NumInput
                      value={formData.passengers}
                      min={0}
                      max={999}
                      onChange={(v) => updateFormData('passengers', Math.max(0, Math.floor(v)))}
                    />
                  </Cell>
                </div>
                <p className="text-[9px] text-gray-500 mb-1">
                  Min crew {stats.minCrew} · quarters capacity {stats.crewCapacity}.
                </p>
                <div className="flex flex-wrap gap-1 mb-2" title="Crew on board">
                  {Array.from({ length: Math.min(formData.crewCount, 80) }).map((_, i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-full border border-gray-400" />
                  ))}
                  {formData.crewCount > 80 && (
                    <span className="text-[9px] text-gray-500">+{formData.crewCount - 80}</span>
                  )}
                </div>

                {formData.crews.length === 0 ? (
                  <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                    No crew assigned. Add named or unnamed crew.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {formData.crews.map((c, index) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1">
                        <div className="min-w-0 text-[11px] text-gray-200">
                          {c.name || <span className="text-gray-500">Unnamed crew</span>}
                          <span className="text-gray-500"> · Lv {c.level} · S{c.str} D{c.dex} C{c.con} I{c.int} W{c.wis} C{c.cha}</span>
                          <span className="text-green-400"> · {c.cost != null ? `${c.cost}gp` : 'cost —'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditCrew(index)}
                            className="text-[10px] bg-blue-700 hover:bg-blue-600 px-1.5 py-0.5 rounded text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCrew(index)}
                            className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-center">
              Select a ship<br />to see details
            </div>
          )}
        </div>
      </div>

{/* Clone / Save As modal */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">
              {formData && templates.some(t => t.id === formData.id) ? 'Clone Ship' : 'Save As'}
            </h2>
            <div>
              <label className="block text-sm text-gray-300 mb-1">New Ship Name</label>
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                placeholder="Enter ship name"
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
                {formData && templates.some(t => t.id === formData.id) ? 'Clone' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-[420px] border border-gray-700">
            <h2 className="text-xl font-bold mb-3 text-white">Unsaved Changes</h2>
            <p className="text-sm text-gray-300 mb-4">
              Save changes to "{formData?.name || 'this ship'}" before leaving?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleUnsavedDiscard}
                className="px-4 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
              >
                Don't Save
              </button>
              <button
                onClick={handleUnsavedCancel}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsavedSave}
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Accessories modal */}
      {showAccessoriesModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-5 rounded-lg w-[560px] max-h-[80vh] border border-gray-700 flex flex-col">
            <h2 className="text-lg font-bold mb-3 text-white">Add Accessories</h2>
            <div className="flex-1 overflow-y-auto space-y-1">
              {accessories.map(acc => (
                <div key={acc.id} className="flex items-center justify-between gap-2 bg-gray-700/50 rounded px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[12px] text-gray-200">
                      {humanize(acc.id)}{' '}
                      <span className="text-gray-500">
                        ({acc.mass}t · {acc.crew} crew · {acc.cost ? `${acc.cost}gp` : '0gp'} · {acc.hittable ? 'hittable' : 'safe'})
                      </span>
                    </div>
                    {acc.effect && <div className="text-[10px] text-gray-400">{acc.effect}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAccessoryCount(acc.id, accessoryCount(acc.id) + 1)}
                    className="flex-none px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                  >
                    Add{accessoryCount(acc.id) > 0 ? ` (${accessoryCount(acc.id)})` : ''}
                  </button>
                </div>
              ))}
              {accessories.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">No accessories in the catalog.</div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowAccessoriesModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ship image picker */}
      {showImagePicker && formData && (
        <ImagePickerModal
          current={formData.imageUrl}
          uploadKey={formData.id || 'new'}
          bucket="ship_images"
          title="Select Ship Image"
          showRaces={false}
          onSelect={(url) => {
            updateFormData('imageUrl', url ?? '');
            setShowImagePicker(false);
          }}
          onClose={() => setShowImagePicker(false)}
        />
      )}

      {/* Add / Edit Crew modal */}
      {showCrewModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-5 rounded-lg w-[420px] border border-gray-700">
            <h2 className="text-lg font-bold mb-3 text-white">{editingCrewIndex !== null ? 'Edit Crew' : 'Add Crew'}</h2>
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <Cell label="Number of crew" widthClass="w-24">
                  <NumInput value={crewDraft.count} min={1} max={Math.max(1, crewSlotsRemaining)} onChange={(v) => setCrewDraft(d => ({ ...d, count: Math.max(1, Math.min(crewSlotsRemaining || 1, Math.floor(v) || 1)) }))} />
                </Cell>
                <Cell label="Name (optional — blank = unnamed)" widthClass="flex-1">
                  <input
                    type="text"
                    value={crewDraft.name}
                    onChange={(e) => setCrewDraft(d => ({ ...d, name: e.target.value }))}
                    className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                  />
                </Cell>
              </div>
              <div className="flex items-end gap-2">
                <Cell label="Level" widthClass="w-16"><NumInput value={crewDraft.level} min={1} max={99} onChange={(v) => setCrewDraft(d => ({ ...d, level: Math.max(1, Math.floor(v) || 1) }))} /></Cell>
                <Cell label="Str"><NumInput value={crewDraft.str} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, str: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
                <Cell label="Dex"><NumInput value={crewDraft.dex} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, dex: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
                <Cell label="Con"><NumInput value={crewDraft.con} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, con: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
                <Cell label="Int"><NumInput value={crewDraft.int} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, int: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
                <Cell label="Wis"><NumInput value={crewDraft.wis} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, wis: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
                <Cell label="Cha"><NumInput value={crewDraft.cha} min={1} max={30} onChange={(v) => setCrewDraft(d => ({ ...d, cha: Math.max(1, Math.min(30, Math.floor(v) || 10)) }))} /></Cell>
              </div>
              <div className="flex items-end gap-2">
                <Cell label="Cost (gp, can be null)" widthClass="flex-1">
                  {crewDraft.cost === null ? (
                    <button
                      type="button"
                      onClick={() => setCrewDraft(d => ({ ...d, cost: 0 }))}
                      className="w-full bg-gray-700 text-gray-400 text-xs rounded px-2 py-1 border border-gray-600 hover:bg-gray-600"
                    >
                      — (null) — set cost
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={crewDraft.cost}
                        min={0}
                        onChange={(e) => setCrewDraft(d => ({ ...d, cost: parseInt(e.target.value) || 0 }))}
                        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      />
                      <button
                        type="button"
                        onClick={() => setCrewDraft(d => ({ ...d, cost: null }))}
                        title="Set cost = null (unknown / no listed cost)"
                        className="flex-none px-2 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded border border-gray-600"
                      >
                        null
                      </button>
                    </div>
                  )}
                </Cell>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => { setShowCrewModal(false); setEditingCrewIndex(null); }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={confirmCrew}
              >
                {editingCrewIndex !== null ? 'Save' : `Add ${Math.max(1, crewDraft.count)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
