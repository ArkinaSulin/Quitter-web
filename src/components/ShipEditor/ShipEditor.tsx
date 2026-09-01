// src/components/ShipEditor/ShipEditor.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipCrew,
  ShipEnvironment,
  ShipFrame,
  ShipMount,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  computeMCBand,
  computeMCParts,
  computeShipBuild,
  ShipBuild,
} from '@/lib/shipStats';
import {
  mapAccessoryRows,
  mapCrewRows,
  mapShipAccessoryRow,
  mapShipArmorRow,
  mapShipComponentRow,
  mapShipFrameRow,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapShipWeaponRow,
  mapWeaponRows,
} from '@/lib/shipMappers';
import { ShipPreview } from '@/components/ShipRenderer/ShipPreview';

const MOUNT_SLOTS = ['Fore', 'Left', 'Right', 'Rear', '360'] as const;

const FRAME_LABELS: Record<string, string> = { tiny: 'Tiny', small: 'Small', medium: 'Medium', large: 'Large' };
const ARMOR_LABELS: Record<string, string> = {
  wood: 'Wood', plated: 'Plated', metal: 'Metal', ceramic: 'Ceramic', stone: 'Stone',
};

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

// TE = speed ÷ MC — HIGHER is better.
function turnsColor(v: number) {
  if (v >= 3) return 'bg-green-700 text-white';
  if (v >= 1.5) return 'bg-yellow-700 text-white';
  return 'bg-red-700 text-white';
}

// Unreachable speed (beyond the active cap) — grey/black out, no number.
const OFF_CELL = 'bg-gray-900 border border-gray-800 text-gray-700';

// Accessory -> special weapon the accessory mounts (drives the special weapon slots).
const SPECIAL_WEAPON_BY_ACCESSORY: Record<string, string> = {
  scorpion_claws: 'scorpion_claws_wpn',
  eyestalk_cannons: 'eyestalk_wpn',
  ram: 'ram_wpn',
  grappling_jaws: 'grappling_jaws_wpn',
  tentacles: 'tentacles_wpn',
};

function buildFromTemplate(
  t: ShipTemplate,
  frames: ShipFrame[],
  armors: ShipArmor[],
  components: ShipComponent[],
  accessories: ShipAccessory[],
  weapons: ShipWeapon[],
): ShipBuild | null {
  const frame = frames.find(f => f.id === t.frameId) || frames[0];
  const armor = armors.find(a => a.id === t.armorId) || armors[0];
  if (!frame || !armor) return null;
  return {
    frame,
    armor,
    components,
    accessoriesCatalog: accessories,
    weaponsCatalog: weapons,
    atmosphereSpeed: t.atmosphereSpeed,
    rudders: t.rudders,
    sails: t.sails,
    lWeap: t.lWeap,
    sWeap: t.sWeap,
    hullR: t.hullR,
    bridge: t.bridge,
    auxHelm: t.auxHelm,
    crewCount: t.crewCount,
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

  const [frames, setFrames] = useState<ShipFrame[]>([]);
  const [armors, setArmors] = useState<ShipArmor[]>([]);
  const [components, setComponents] = useState<ShipComponent[]>([]);
  const [accessories, setAccessories] = useState<ShipAccessory[]>([]);
  const [weaponsCatalog, setWeaponsCatalog] = useState<ShipWeapon[]>([]);

  const [formData, setFormData] = useState<ShipTemplate | null>(null);
  const [environment, setEnvironment] = useState<ShipEnvironment>('space');

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

  // Performance box: formula text is hidden behind the [formulas] button.
  const [showFormula, setShowFormula] = useState(false);
  // Accessory catalog picker modal.
  const [showAccessoriesModal, setShowAccessoriesModal] = useState(false);
  // Crew roster modal.
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [editingCrewIndex, setEditingCrewIndex] = useState<number | null>(null);
  const [crewDraft, setCrewDraft] = useState<{ count: number; name: string; level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; cost: number | null }>({
    count: 1, name: '', level: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cost: null,
  });

  const build = formData
    ? buildFromTemplate(formData, frames, armors, components, accessories, weaponsCatalog)
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

  const addWeaponToSlot = (mount: ShipMount, defaultWeaponId?: string) => {
    if (!formData) return;
    const id = defaultWeaponId || weaponsCatalog.find(w => w.mount === mount)?.id || weaponsCatalog[0]?.id || '';
    updateFormData('weapons', [...formData.weapons, {
      weaponId: id,
      mountSlot: mount === 'special' ? '360' : 'Fore',
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
        const [templatesRes, framesRes, armorsRes, componentsRes, accessoriesRes, weaponsRes, templateAccessoriesRes, templateWeaponsRes, crewsRes] = await Promise.all([
          supabase.from('ship_templates').select('*').order('name'),
          supabase.from('ship_frames').select('*').order('mass_cap'),
          supabase.from('ship_armors').select('*').order('id'),
          supabase.from('ship_components').select('*').order('id'),
          supabase.from('ship_accessories').select('*').order('id'),
          supabase.from('ship_weapons').select('*').order('id'),
          supabase.from('ship_template_accessories').select('*'),
          supabase.from('ship_template_weapons').select('*'),
          supabase.from('ship_crews').select('*'),
        ]);
        if (templatesRes.error) throw templatesRes.error;
        if (framesRes.error) throw framesRes.error;
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
        setFrames((framesRes.data || []).map(mapShipFrameRow));
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
    const firstFrame = frames.find(f => f.id === 'small') || frames[0];
    const firstArmor = armors.find(a => a.id === 'wood') || armors[0];
    return {
      id: crypto.randomUUID(),
      name: 'New Ship',
      role: '',
      frameId: firstFrame?.id || '',
      armorId: firstArmor?.id || '',
      atmosphereSpeed: Math.min(4, firstFrame?.topSpeed || 4),
      rudders: 0,
      sails: 0,
      lWeap: 0,
      sWeap: 0,
      hullR: 0,
      bridge: 0,
      auxHelm: 0,
      crewCount: 0,
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
        .select('*, ship_template_accessories(*), ship_template_weapons(*)')
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
        .select('*, ship_template_accessories(*), ship_template_weapons(*)')
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

  const handleSaveAs = () => {
    if (readOnly) return;
    if (!formData) return;
    setCloneName(`${formData.name} (Copy)`);
    setCloneError('');
    setShowCloneModal(true);
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

  const selectedFrame = formData ? frames.find(f => f.id === formData.frameId) : null;
  const selectedArmor = formData ? armors.find(a => a.id === formData.armorId) : null;
  const capacity = stats ? Math.max(0, Math.floor(stats.availableSpace)) : 0;
  const cargoClamped = formData ? Math.max(0, Math.min(formData.cargoArea, capacity)) : 0;
  const massOverload = stats ? stats.availableSpace < 0 : false;
  const deckOverload = stats ? stats.deckUsed > stats.deckSpace : false;
  const activeCap = build ? Math.min(stats!.topSpeed, environment === 'space' ? stats!.topSpeed : (stats!.atmosphereSpeed || stats!.topSpeed)) : 0;
  // Roster is capped at the crew complement set in the Components box.
  const crewSlotsUsed = formData ? formData.crews.length : 0;
  const crewSlotsRemaining = formData ? Math.max(0, formData.crewCount - formData.crews.length) : 0;


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
                <button
                  onClick={handleClone}
                  disabled={!formData}
                  className="flex-1 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clone
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
                const tFrame = frames.find(f => f.id === template.frameId);
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
                      {FRAME_LABELS[template.frameId] || tFrame?.id || '?'} · {ARMOR_LABELS[template.armorId] || '?'}
                    </div>
                  </div>
                );
              })}
            {templates.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                No ships found. Create one with "New".
                <div className="text-[10px] text-gray-600 mt-2">
                  Empty database? Ensure the ship seed (migration 067) is applied — the
                  tables exist but ship_templates has no rows.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Middle — builder */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0d0d1a]">
          {formData ? (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                <fieldset disabled={readOnly} className="max-w-3xl space-y-4">
                  {/* Identity */}
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
                  </div>

                  {/* Frame + Armor + Atmosphere speed */}
                  <div className="flex items-end gap-2">
                    <Cell label="Frame" widthClass="flex-1">
                      <select
                        value={formData.frameId || ''}
                        onChange={(e) => {
                          const frame = frames.find(f => f.id === e.target.value);
                          updateFormData('frameId', e.target.value);
                          if (frame) {
                            setFormData(prev => prev ? {
                              ...prev,
                              frameId: e.target.value,
                              rudders: Math.min(prev.rudders, frame.maxRudders),
                              atmosphereSpeed: Math.min(prev.atmosphereSpeed || 4, frame.topSpeed),
                            } : prev);
                          }
                        }}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      >
                        {frames.map(frame => (
                          <option key={frame.id} value={frame.id}>
                            {FRAME_LABELS[frame.id] || frame.id} ({frame.massCap}t · {frame.baseHp} HP · Top {frame.topSpeed} · {frame.deckSpace} deck)
                          </option>
                        ))}
                      </select>
                    </Cell>
                    <Cell label="Armor" widthClass="flex-1">
                      <select
                        value={formData.armorId || ''}
                        onChange={(e) => updateFormData('armorId', e.target.value)}
                        className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                      >
                        {armors.map(armor => (
                          <option key={armor.id} value={armor.id}>
                            {ARMOR_LABELS[armor.id] || armor.id} (AC {armor.ac} · BoxHP {armor.boxHp} · eats {Math.round(armor.massFactor * 100)}%)
                          </option>
                        ))}
                      </select>
                    </Cell>
                    <Cell label="Atmo speed" widthClass="w-20">
                      <NumInput value={formData.atmosphereSpeed} min={0} max={selectedFrame?.topSpeed || 12} onChange={(v) => updateFormData('atmosphereSpeed', Math.max(0, Math.min(selectedFrame?.topSpeed || 12, Math.floor(v))))} />
                    </Cell>
                  </div>

                  {/* Stat */}
                  {stats && build && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <div className="grid grid-cols-4 gap-1">
                        <StatCell label="Armor Class">{selectedArmor?.ac ?? '—'}</StatCell>
                        <StatCell label="Hull HP">{stats.shipHp}</StatCell>
                        <StatCell label="Damage Threshold">{stats.dt}</StatCell>
                        <StatCell label="Officer actions / game turn">{stats.officerActions}</StatCell>
                      </div>
                      <div className="grid grid-cols-4 gap-1 mt-2">
                        <StatCell label="Mass">{Math.round(stats.ladenMass)}t</StatCell>
                        <StatCell label="Cargo">{cargoClamped}t</StatCell>
                        <StatCell label="Reserve mass">{Math.max(0, Math.round(stats.unclaimedSpace))}t</StatCell>
                        <StatCell label="Deck used / max" tone={deckOverload ? 'red' : 'default'}>{Math.round(stats.deckUsed)} / {stats.deckSpace}</StatCell>
                      </div>
                      <div className="grid grid-cols-4 gap-1 mt-2">
                        <StatCell label="Current crew / Minimum crew">{formData.crewCount} / {stats.minCrew}</StatCell>
                        <StatCell label="Crew quarters">{stats.crewQuarters}</StatCell>
                        <StatCell label="Build cost">{stats.buildCost.toLocaleString()}gp</StatCell>
                        <StatCell label="Upkeep">—</StatCell>
                      </div>
                      <p className="text-[9px] text-gray-600 mt-2 border-t border-gray-700 pt-1">
                        Officer actions: no bridge → max(1, helmsman Int modifier) · with bridge → max(4, 4 + captain Int modifier).
                        Int bonus comes from crew dropped onto stations on the map — default 0 here.
                      </p>
                    </div>
                  )}

                  {/* Ship performance */}
                  {stats && build && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <div className="flex items-end gap-2 mb-1">
                        <div className="flex-1">
                          <label className="block text-[9px] text-gray-500">Acceleration (empty)</label>
                          <div className="text-sm font-bold text-yellow-400">{stats.accelEmpty}</div>
                        </div>
                        <div className="flex-1">
                          <label className="block text-[9px] text-gray-500">Acceleration (laden)</label>
                          <div className="text-sm font-bold text-yellow-400">{stats.accelLaden}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowFormula(v => !v)}
                          className="px-2 py-1 text-[10px] bg-gray-700 border border-gray-600 text-gray-300 rounded hover:bg-gray-600"
                        >
                          {showFormula ? 'hide formulas' : 'formulas'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between mb-0.5">
                        <label className="block text-[10px] text-gray-400">
                          MC — hexes to travel per 60° turn (lower = better)
                        </label>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-500 mr-1">Env:</span>
                          {(['space', 'atmosphere'] as ShipEnvironment[]).map(env => (
                            <button
                              key={env}
                              type="button"
                              onClick={() => setEnvironment(env)}
                              className={`px-2 py-0.5 text-[10px] rounded border ${
                                environment === env
                                  ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                              }`}
                            >
                              {env === 'space' ? `Space ${stats.topSpeed}` : `Atmo ${stats.atmosphereSpeed}`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="block text-[10px] text-gray-400 mb-1">
                        TE (Turning Efficiency) = speed ÷ MC — maximum 60° turns per game turn (higher = better)
                      </label>

                      {showFormula && (() => {
                        const p = computeMCParts(build, stats.ladenMass);
                        return (
                          <div className="text-[9px] font-mono text-gray-500 mb-2 leading-relaxed overflow-x-auto">
                            <div>MC(s) — hexes per 60° turn · mass {p.mass}t (empty {Math.round(stats.emptyMass)} + cargo {cargoClamped})</div>
                            <div>fill = rudders / frameMassCap = {p.fill.toFixed(4)}</div>
                            <div>u* = clamp(0.33 + 5.4·fill + 0.2·(25/mass − 0.5), 0.33, 0.6) = {p.uStar.toFixed(2)}</div>
                            <div>w = clamp(0.4 + 0.05·rudders, 0.45, 0.7) = {p.width.toFixed(2)} · TE_max = clamp(3·(25/mass)^0.7, 0.8, 3) = {p.teMax.toFixed(2)}</div>
                            <div>TE(s) = TE_max·max(0, 1 − ((s/T − u*)/w)²) · MC(s) = max(1, round(s / max(0.5, TE(s)))) · TE = s ÷ MC</div>
                            <div>Acceleration = round(18 × sails ÷ mass) · Officer actions = no bridge: max(1, helmsman Int) · bridge: max(4, 4 + captain Int)</div>
                          </div>
                        );
                      })()}

                      {/* Chart: always-14 speed axis, active cap greys out the rest */}
                      <div className="overflow-x-auto">
                      {(() => {
                        const axisMax = Math.max(14, ...frames.map(f => f.topSpeed));
                        const speeds = Array.from({ length: axisMax }, (_, i) => i + 1);
                        const reachable = (s: number) => s <= activeCap && s <= stats.topSpeed;
                        const loadBand = (mass: number) => {
                          const band = computeMCBand(build, mass);
                          return speeds.map(s => (s <= stats.topSpeed ? band[s - 1] : undefined));
                        };
                        const row = (label: string, cells: ({ mc: number; te: number } | undefined)[], colorFn: (v: number) => string, showTe = false) => (
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-[10px] text-gray-400 w-16 truncate flex-none">{label}</span>
                            {speeds.map(s => {
                              const cell = cells[s - 1];
                              if (!reachable(s) || !cell) {
                                return <div key={s} title={`Speed ${s}: unreachable in ${environment}`} className={`w-6 h-5 rounded flex-none ${OFF_CELL}`} />;
                              }
                              return (
                                <div
                                  key={s}
                                  title={`Speed ${s}: MC ${cell.mc} (${cell.mc} hex${cell.mc > 1 ? 'es' : ''} per 60° turn) · TE ${cell.te}`}
                                  className={`w-6 h-5 rounded text-[9px] flex-none flex items-center justify-center ${colorFn(showTe ? cell.te : cell.mc)}`}
                                >
                                  {showTe ? cell.te : cell.mc}
                                </div>
                              );
                            })}
                          </div>
                        );
                        const bandHalf = loadBand(stats.emptyMass + Math.round(0.5 * capacity));
                        const bandLaden = loadBand(stats.ladenMass);
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-[10px] text-gray-400 w-16 truncate flex-none">Speed</span>
                              {speeds.map(s => (
                                <div key={s} className={`w-6 text-center text-[9px] flex-none ${s <= activeCap ? 'text-gray-300' : 'text-gray-600'}`}>{s}</div>
                              ))}
                            </div>
                            {row('MC @ 50%', bandHalf, mcColor)}
                            {row('MC (laden)', bandLaden, mcColor)}
                            {row('TE (laden)', bandLaden, turnsColor, true)}
                          </div>
                        );
                      })()}
                      </div>

                      {/* Cargo bay */}
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <label className="block text-[10px] text-gray-400 mb-1">
                          Cargo bay: {cargoClamped}t / {capacity}t — the Laden row tracks this
                        </label>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(1, capacity)}
                          step="1"
                          value={cargoClamped}
                          disabled={capacity === 0}
                          onChange={(e) => updateFormData('cargoArea', parseInt(e.target.value))}
                          className="w-full accent-yellow-400"
                        />
                        {massOverload && (
                          <p className="text-[10px] text-red-400 mt-1">
                            Over mass cap by {Math.round(-stats.availableSpace)}t — soft penalty (Acceleration/MC suffer).
                          </p>
                        )}
                        {!massOverload && capacity === 0 && (
                          <p className="text-[10px] text-gray-500 mt-1">No spare capacity for cargo.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Components */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <label className="block text-[10px] text-gray-400 mb-2">Components (counts drive mass, deck, crew, pools)</label>
                    <div className="grid grid-cols-4 gap-x-2 gap-y-2">
                      <Cell label="Auxiliary helm"><NumInput value={formData.auxHelm} min={0} max={2} onChange={(v) => updateFormData('auxHelm', Math.max(0, Math.min(2, Math.floor(v))))} /></Cell>
                      <Cell label="Command bridge"><NumInput value={formData.bridge} min={0} max={2} onChange={(v) => updateFormData('bridge', Math.max(0, Math.min(2, Math.floor(v))))} /></Cell>
                      <Cell label="Sail"><NumInput value={formData.sails} min={0} max={99} onChange={(v) => updateFormData('sails', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Rudder"><NumInput value={formData.rudders} min={0} max={selectedFrame?.maxRudders || 5} onChange={(v) => updateFormData('rudders', Math.max(0, Math.min(selectedFrame?.maxRudders || 5, Math.floor(v))))} /></Cell>
                      <Cell label="Large weapon anchor"><NumInput value={formData.lWeap} min={0} max={99} onChange={(v) => updateFormData('lWeap', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Small weapon anchor"><NumInput value={formData.sWeap} min={0} max={99} onChange={(v) => updateFormData('sWeap', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Hull reinforcement"><NumInput value={formData.hullR} min={0} max={99} onChange={(v) => updateFormData('hullR', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Crew"><NumInput value={formData.crewCount} min={0} max={999} onChange={(v) => updateFormData('crewCount', Math.max(0, Math.floor(v)))} /></Cell>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">Crew = the crew complement (current crew on board). Minimum crew to operate comes from the components themselves.</p>
                  </div>

                  {/* Specials / accessories */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] text-gray-400">Specials / Accessories</label>
                      <button
                        type="button"
                        onClick={() => setShowAccessoriesModal(true)}
                        className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                      >
                        + Add Accessories
                      </button>
                    </div>
                    {formData.accessories.length === 0 ? (
                      <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                        No specials added.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {formData.accessories.map(a => {
                          const acc = accessories.find(x => x.id === a.accessoryId);
                          if (!acc) return null;
                          return (
                            <div key={a.accessoryId} className="flex items-center justify-between gap-2 bg-gray-800 rounded px-2 py-1">
                              <div className="min-w-0">
                                <div className="text-[11px] text-gray-200">
                                  {humanize(acc.id)}{' '}
                                  <span className="text-gray-500">
                                    ({acc.mass}t · {acc.crew} crew · {acc.cost ? `${acc.cost}gp` : '0gp'} · {acc.hittable ? 'hittable' : 'safe'})
                                  </span>
                                </div>
                                {acc.effect && <div className="text-[10px] text-gray-400">{acc.effect}</div>}
                              </div>
                              <div className="flex items-center gap-1">
                                <Stepper value={a.count} onChange={(v) => setAccessoryCount(acc.id, v)} max={3} />
                                <button
                                  type="button"
                                  onClick={() => setAccessoryCount(acc.id, 0)}
                                  className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white"
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

                  {/* Weapons — one slot per weapon anchor */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <label className="block text-[10px] text-gray-400 mb-2">Weapons — one slot per weapon anchor (set in Components)</label>
                    {(() => {
                      const byMount: Record<string, number[]> = { large: [], small: [], special: [] };
                      formData.weapons.forEach((w, idx) => {
                        const m = weaponsCatalog.find(x => x.id === w.weaponId)?.mount;
                        if (m && byMount[m]) byMount[m].push(idx);
                      });
                      const slotRow = (label: string, idx: number | undefined, mount: ShipMount, defaultWeaponId?: string) => {
                        if (idx === undefined) {
                          return (
                            <div key={label} className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] text-gray-400 w-40 truncate flex-none">{label}</span>
                              <button
                                type="button"
                                onClick={() => addWeaponToSlot(mount, defaultWeaponId)}
                                className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                              >
                                + Add Weapon
                              </button>
                            </div>
                          );
                        }
                        const w = formData.weapons[idx];
                        return (
                          <div key={label} className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-gray-400 w-40 truncate flex-none">{label}</span>
                            <select
                              value={w.weaponId}
                              onChange={(e) => setWeaponRow(idx, 'weaponId', e.target.value)}
                              className="flex-1 min-w-0 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                            >
                              {weaponsCatalog.filter(x => x.mount === mount).map(weap => (
                                <option key={weap.id} value={weap.id}>{humanize(weap.id)} — {weap.damage} (cycle {weap.fireCycleRd})</option>
                              ))}
                            </select>
                            <select
                              value={w.mountSlot}
                              onChange={(e) => setWeaponRow(idx, 'mountSlot', e.target.value)}
                              className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400 flex-none"
                            >
                              {MOUNT_SLOTS.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
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
                        );
                      };
                      const specialAccessories = formData.accessories.filter(a => SPECIAL_WEAPON_BY_ACCESSORY[a.accessoryId]);
                      const rows: React.ReactNode[] = [];
                      for (let i = 0; i < formData.lWeap; i++) rows.push(slotRow(`Large weapon anchor ${i + 1}`, byMount.large[i], 'large'));
                      for (let i = 0; i < formData.sWeap; i++) rows.push(slotRow(`Small weapon anchor ${i + 1}`, byMount.small[i], 'small'));
                      specialAccessories.forEach((a, i) => rows.push(slotRow(`Special (${humanize(a.accessoryId)})`, byMount.special[i], 'special', SPECIAL_WEAPON_BY_ACCESSORY[a.accessoryId])));
                      if (rows.length === 0) {
                        return (
                          <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                            Add weapon anchors in Components to assign weapons.
                          </div>
                        );
                      }
                      return <div className="space-y-1.5">{rows}</div>;
                    })()}
                  </div>

                  {/* Crews */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] text-gray-400">Crews — ship roster ({formData.crews.length} / {formData.crewCount} crew slots)</label>
                      <button
                        type="button"
                        onClick={openAddCrew}
                        disabled={crewSlotsRemaining === 0}
                        className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        + Add Crew
                      </button>
                    </div>
                    {formData.crews.length === 0 && (
                      <p className="text-[10px] text-gray-500 mb-1">Roster is capped at the Crew complement (Components box).</p>
                    )}
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
                </fieldset>
              </div>

              {/* Sticky Save bar */}
              {!readOnly && (
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
              )}
            </>
          ) : (
            <div className="flex items-center justify-center flex-1 text-gray-500">
              Select a ship from the list or create a new one
            </div>
          )}
        </div>

        {/* Right — shared ship preview (ShipRenderer), also used by the ScenarioMap */}
        <div className="flex-[0_0_24%] min-w-[220px] max-w-[30%] p-4 border-l border-gray-700 bg-[#0d0d1a] overflow-y-auto">
          {formData && build && stats ? (
            <ShipPreview build={build} stats={stats} />
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
