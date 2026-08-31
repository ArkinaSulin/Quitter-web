// src/components/ShipEditor/ShipEditor.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import {
  ShipAccessory,
  ShipArmor,
  ShipComponent,
  ShipEnvironment,
  ShipFrame,
  ShipTemplate,
  ShipWeapon,
} from '@/types/ship';
import {
  computeShipBuild,
  ShipBuild,
} from '@/lib/shipStats';
import {
  mapAccessoryRows,
  mapShipTemplateRow,
  mapShipTemplateToRow,
  mapWeaponRows,
} from '@/lib/shipMappers';
import { ShipPreview } from '@/components/ShipRenderer/ShipPreview';

const MOUNT_SLOTS = ['Fore', 'Side', 'Rear', '360', 'X-quadrant'] as const;

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

function mcColor(mc: number) {
  if (mc >= 4) return 'bg-amber-500 text-black font-bold';
  if (mc === 3) return 'bg-green-700 text-white';
  if (mc === 2) return 'bg-yellow-800 text-white';
  return 'bg-gray-700 text-gray-300';
}

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
    extraCrew: t.extraCrew,
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
  const [environment, setEnvironment] = useState<ShipEnvironment>('atmosphere');

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneError, setCloneError] = useState('');

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

  const addWeaponRow = () => {
    if (!formData) return;
    const first = weaponsCatalog.find(w => w.mount === 'small');
    updateFormData('weapons', [...formData.weapons, {
      weaponId: first?.id || weaponsCatalog[0]?.id || '',
      mountSlot: 'Fore',
      count: 1,
    }]);
  };

  const removeWeaponRow = (index: number) => {
    if (!formData) return;
    updateFormData('weapons', formData.weapons.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [templatesRes, framesRes, armorsRes, componentsRes, accessoriesRes, weaponsRes] = await Promise.all([
          supabase.from('ship_templates').select('*, ship_template_accessories(*), ship_template_weapons(*)').order('name'),
          supabase.from('ship_frames').select('*').order('mass_cap'),
          supabase.from('ship_armors').select('*').order('id'),
          supabase.from('ship_components').select('*').order('id'),
          supabase.from('ship_accessories').select('*').order('id'),
          supabase.from('ship_weapons').select('*').order('id'),
        ]);
        if (templatesRes.error) throw templatesRes.error;
        if (framesRes.error) throw framesRes.error;
        if (armorsRes.error) throw armorsRes.error;
        if (componentsRes.error) throw componentsRes.error;
        if (accessoriesRes.error) throw accessoriesRes.error;
        if (weaponsRes.error) throw weaponsRes.error;

        setTemplates((templatesRes.data || []).map(mapShipTemplateRow));
        setFrames(framesRes.data || []);
        setArmors(armorsRes.data || []);
        setComponents(componentsRes.data || []);
        setAccessories(accessoriesRes.data || []);
        setWeaponsCatalog(weaponsRes.data || []);
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
      extraCrew: 0,
      cargoArea: 0,
      accessories: [],
      weapons: [],
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
  const smallAssigned = formData?.weapons.filter(w => weaponsCatalog.find(x => x.id === w.weaponId)?.mount === 'small').reduce((s, w) => s + w.count, 0) || 0;
  const largeAssigned = formData?.weapons.filter(w => weaponsCatalog.find(x => x.id === w.weaponId)?.mount === 'large').reduce((s, w) => s + w.count, 0) || 0;

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

                  {/* Stat readout */}
                  {stats && build && (
                    <>
                      <div className="grid grid-cols-4 gap-2 p-2.5 bg-gray-800 rounded border border-gray-700">
                        <div>
                          <label className="block text-[10px] text-gray-400">Ship HP</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.shipHp}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">DT</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.dt}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Box HP</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.boxHp}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Pool HP</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.pools.total}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 p-2.5 bg-gray-800 rounded border border-gray-700">
                        <div>
                          <label className="block text-[10px] text-gray-400">Mass (empty)</label>
                          <div className={`text-lg font-bold ${massOverload ? 'text-red-400' : 'text-yellow-400'}`}>{Math.round(stats.emptyMass)}t / {build.frame.massCap}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Available</label>
                          <div className="text-lg font-bold text-yellow-400">{Math.max(0, Math.round(stats.availableSpace))}t</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Unclaimed</label>
                          <div className="text-lg font-bold text-yellow-400">{Math.max(0, Math.round(stats.unclaimedSpace))}t</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Deck</label>
                          <div className={`text-lg font-bold ${deckOverload ? 'text-red-400' : 'text-yellow-400'}`}>{Math.round(stats.deckUsed)} / {stats.deckSpace}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 p-2.5 bg-gray-800 rounded border border-gray-700">
                        <div>
                          <label className="block text-[10px] text-gray-400">Accel (empty)</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.accelEmpty}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Accel (laden)</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.accelLaden}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Top speed</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.topSpeed}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Active cap</label>
                          <div className="text-lg font-bold text-yellow-400">
                            {activeCap}
                            <span className="text-[10px] text-gray-500 ml-1">({environment})</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 p-2.5 bg-gray-800 rounded border border-gray-700">
                        <div>
                          <label className="block text-[10px] text-gray-400">Crew</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.crew}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Crew quarters</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.crewQuarters}t</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400">Build cost</label>
                          <div className="text-lg font-bold text-yellow-400">{stats.buildCost.toLocaleString()}gp</div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Environment preview + MC bands */}
                  {stats && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] text-gray-400">
                          MC — turn capacity per game turn (spent across 5 segments)
                        </label>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-500 mr-1">Env:</span>
                          {(['atmosphere', 'space'] as ShipEnvironment[]).map(env => (
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
                              {env === 'atmosphere' ? `Atmo ${stats.atmosphereSpeed}` : `Space ${stats.topSpeed}`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400 w-12">Unladen</span>
                          {stats.mcBandEmpty.map(({ speed, mc }) => (
                            <div key={speed} title={`Speed ${speed}: ${mc} turn${mc > 1 ? 's' : ''}`} className={`w-5 h-5 rounded text-[9px] flex items-center justify-center ${mcColor(mc)}`}>
                              {mc}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400 w-12">Laden</span>
                          {stats.mcBandLaden.map(({ speed, mc }) => (
                            <div key={speed} title={`Speed ${speed}: ${mc} turn${mc > 1 ? 's' : ''}`} className={`w-5 h-5 rounded text-[9px] flex items-center justify-center ${mcColor(mc)}`}>
                              {mc}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-500 mt-1 px-0.5">
                        <span>Speed 1</span>
                        <span>Speed {stats.topSpeed}</span>
                      </div>
                    </div>
                  )}

                  {/* Component counts */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700 space-y-2">
                    <label className="block text-[10px] text-gray-400">Components (counts drive mass / deck / crew / pools)</label>
                    <div className="flex items-end gap-2 flex-wrap">
                      <Cell label="Rudders"><NumInput value={formData.rudders} min={0} max={selectedFrame?.maxRudders || 5} onChange={(v) => updateFormData('rudders', Math.max(0, Math.min(selectedFrame?.maxRudders || 5, Math.floor(v))))} /></Cell>
                      <Cell label="Sails"><NumInput value={formData.sails} min={0} max={99} onChange={(v) => updateFormData('sails', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="L.Weap"><NumInput value={formData.lWeap} min={0} max={99} onChange={(v) => updateFormData('lWeap', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="S.Weap"><NumInput value={formData.sWeap} min={0} max={99} onChange={(v) => updateFormData('sWeap', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Hull R"><NumInput value={formData.hullR} min={0} max={99} onChange={(v) => updateFormData('hullR', Math.max(0, Math.floor(v)))} /></Cell>
                      <Cell label="Bridge"><NumInput value={formData.bridge} min={0} max={2} onChange={(v) => updateFormData('bridge', Math.max(0, Math.min(2, Math.floor(v))))} /></Cell>
                      <Cell label="Aux helm"><NumInput value={formData.auxHelm} min={0} max={2} onChange={(v) => updateFormData('auxHelm', Math.max(0, Math.min(2, Math.floor(v))))} /></Cell>
                      <Cell label="Extra crew"><NumInput value={formData.extraCrew} step={1} min={0} max={99} onChange={(v) => updateFormData('extraCrew', Math.max(0, Math.floor(v)))} /></Cell>
                    </div>
                  </div>

                  {/* Accessories */}
                  {accessories.length > 0 && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <label className="block text-[10px] text-gray-400 mb-2">Specials / Accessories</label>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {accessories.map(acc => (
                          <div key={acc.id} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-gray-300 truncate" title={acc.effect || undefined}>
                              {humanize(acc.id)}
                              {acc.hittable ? '' : <span className="text-gray-500"> (safe)</span>}
                            </span>
                            <Stepper value={accessoryCount(acc.id)} onChange={(v) => setAccessoryCount(acc.id, v)} max={3} />
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-2">Watertight, Low Visibility and Air Envelope are safe (no hit boxes). Claws/Eyestalk use the small weapon anchor.</p>
                    </div>
                  )}

                  {/* Cargo slider */}
                  {stats && (
                    <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                      <label className="block text-[10px] text-gray-400 mb-1">
                        Cargo load (designated): {cargoClamped}t of {capacity}t capacity — drives the laden readout
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
                          Over mass cap by {Math.round(-stats.availableSpace)}t — soft penalty (Accel/MC suffer).
                        </p>
                      )}
                      {!massOverload && capacity === 0 && (
                        <p className="text-[10px] text-gray-500 mt-1">No spare capacity for cargo.</p>
                      )}
                    </div>
                  )}

                  {/* Weapons */}
                  <div className="p-2.5 bg-gray-800 rounded border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] text-gray-400">Weapon assignments (fills the L/S.Weap slots)</label>
                      <button
                        type="button"
                        onClick={addWeaponRow}
                        className="px-2 py-0.5 text-[11px] bg-green-800 border border-yellow-400 text-white rounded hover:bg-green-700 transition"
                      >
                        + Add Weapon
                      </button>
                    </div>
                    {(formData.lWeap > 0 || formData.sWeap > 0) && (
                      <div className="flex gap-3 text-[10px] text-gray-400 mb-1">
                        <span className={smallAssigned === formData.sWeap ? 'text-gray-500' : 'text-amber-400'}>
                          S.Weap slots {formData.sWeap} · assigned {smallAssigned}
                        </span>
                        <span className={largeAssigned === formData.lWeap ? 'text-gray-500' : 'text-amber-400'}>
                          L.Weap slots {formData.lWeap} · assigned {largeAssigned}
                        </span>
                      </div>
                    )}
                    {formData.weapons.length === 0 ? (
                      <div className="text-[11px] text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 text-center">
                        No weapons assigned. Add a weapon from the catalog and pick a mount slot.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {formData.weapons.map((w, index) => {
                          const weapon = weaponsCatalog.find(x => x.id === w.weaponId);
                          return (
                            <div key={index} className="flex items-center gap-2">
                              <select
                                value={w.weaponId}
                                onChange={(e) => setWeaponRow(index, 'weaponId', e.target.value)}
                                className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                              >
                                {weaponsCatalog.map(weap => (
                                  <option key={weap.id} value={weap.id}>
                                    {humanize(weap.id)} — {weap.damage} ({weap.mount}, cycle {weap.fireCycleRd})
                                  </option>
                                ))}
                              </select>
                              <select
                                value={w.mountSlot}
                                onChange={(e) => setWeaponRow(index, 'mountSlot', e.target.value)}
                                className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-yellow-400"
                              >
                                {MOUNT_SLOTS.map(slot => (
                                  <option key={slot} value={slot}>{slot}</option>
                                ))}
                              </select>
                              <Stepper value={w.count} onChange={(v) => setWeaponRow(index, 'count', v)} min={1} max={8} />
                              <button
                                type="button"
                                onClick={() => removeWeaponRow(index)}
                                className="text-[10px] bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded text-white"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {weaponsCatalog.length === 0 && (
                      <p className="text-[10px] text-gray-500 mt-1">Weapon catalog is empty.</p>
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
    </div>
  );
}
