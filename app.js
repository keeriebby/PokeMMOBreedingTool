import {
  PricingConfig, SpeciesDB, buildFullPlan, expandOnHand, canonicalNature, parseIVs, formatIVs,
  serializeTree, buildShoppingList, renderPlan, leaves, breeds, NATURES,
} from './breeding.js';

const { createApp, ref, reactive, watch, nextTick, onMounted } = Vue;

// ---- Autocomplete input (works the same on desktop and mobile; no <datalist>) ----
const AutoInput = {
    name: 'AutoInput',
    props: ['modelValue', 'options', 'placeholder', 'inputClass', 'showAll'],
    emits: ['update:modelValue'],
    data() { return { open: false, active: -1 }; },
    computed: {
        matches() {
            const q = (this.modelValue || '').trim().toLowerCase();
            const opts = this.options || [];
            if (!q) return this.showAll ? opts.slice(0, 30) : [];
            const starts = opts.filter((o) => o.toLowerCase().startsWith(q));
            const has = opts.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
            const list = [...starts, ...has].slice(0, 8);
            return list.length === 1 && list[0].toLowerCase() === q ? [] : list;   // already typed in full
        },
    },
    methods: {
        onInput(e) { this.$emit('update:modelValue', e.target.value); this.open = true; this.active = -1; },
        pick(v) { this.$emit('update:modelValue', v); this.open = false; this.active = -1; },
        move(d) {
            if (!this.matches.length) return;
            this.open = true;
            this.active = (this.active + d + this.matches.length) % this.matches.length;
        },
        onEnter(e) { if (this.open && this.active >= 0) { e.preventDefault(); this.pick(this.matches[this.active]); } },
        close() { setTimeout(() => { this.open = false; }, 150); },
    },
    template: `
        <div class="relative">
            <input :class="inputClass" :placeholder="placeholder" :value="modelValue"
                   autocomplete="off" autocapitalize="off" spellcheck="false"
                   @input="onInput" @focus="open = true" @blur="close"
                   @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
                   @keydown.enter="onEnter" @keydown.esc="open = false">
            <ul v-if="open && matches.length" class="absolute z-30 mt-1 w-full min-w-[9rem] max-h-56 overflow-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl text-sm">
                <li v-for="(m, i) in matches" :key="m"
                    :class="i === active ? 'bg-emerald-700 text-white' : 'text-gray-200 hover:bg-gray-700'"
                    class="px-3 py-1.5 cursor-pointer"
                    @mousedown.prevent @click="pick(m)">{{ m }}</li>
            </ul>
        </div>
    `
};

// ---- Saved progress (localStorage) ----
// progress = { [nodeId]: true } for the current plan. Node ids are stable for a given
// species + IVs + nature, so a plan can be reloaded later and pick up where you left off.
const store = reactive({ progress: {} });
const PROGRESS_PREFIX = 'breedtool:progress:v1:';
const INPUTS_KEY = 'breedtool:inputs:v1';
const ONHAND_KEY = 'breedtool:onhand:v1';

const loadJSON = (key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const saveJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / storage full */ }
};

const TreeNode = {
    name: 'TreeNode',
    props: ['node', 'orientation'],
    methods: {
        isDone(id) { return !!store.progress[id]; },
        toggle(id) { store.progress[id] = !store.progress[id]; },
    },
    template: `
        <div :class="['flex items-center justify-center', orientation === 'horizontal' ? 'flex-row space-x-12' : 'flex-col space-y-12']">
            <div class="relative">
                <!-- Breed Node -->
                <div v-if="node.type === 'breed'" :class="isDone(node.id) ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-gray-800 border-gray-700'" class="border-2 rounded-xl p-3 w-64 shadow-xl transition-all duration-300">
                    <div class="flex justify-between items-center mb-1 gap-1">
                        <span class="font-bold text-sm text-gray-100 flex items-center gap-1">
                            {{ node.species }}
                            <span :class="node.gender.includes('Female') ? 'text-pink-400' : (node.gender.includes('Male') ? 'text-blue-400' : 'text-gray-400')" class="font-bold text-xs">
                                {{ node.gender }}
                            </span>
                        </span>
                        <span class="text-[10px] bg-gray-900 text-gray-400 px-1.5 py-0.5 rounded shrink-0">Bred</span>
                    </div>
                    <div class="bg-gray-900 rounded p-1.5 text-center font-mono text-xs font-bold text-emerald-400 mb-2 border border-gray-800 tracking-wider">
                        {{ node.ivs }}
                    </div>
                    <div class="text-xs text-gray-300 mb-2 flex justify-between">
                        <span>Nature: <strong :class="node.nature !== 'Any' ? 'text-amber-300' : 'text-gray-400'">{{ node.nature }}</strong></span>
                    </div>
                    <div v-if="node.held_item" class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">
                        Holds: {{ node.held_item }}
                    </div>
                    <div v-else class="bg-emerald-900/30 border border-emerald-500/30 rounded p-1 text-center text-xs text-emerald-300 font-medium mb-2">
                        Final Target Result
                    </div>
                    <div class="flex items-center space-x-2 pt-2 border-t border-gray-700">
                        <input type="checkbox" :checked="isDone(node.id)" @change="toggle(node.id)" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="isDone(node.id) ? 'text-emerald-400' : 'text-gray-300'">Done (collapse parents)</label>
                    </div>
                </div>

                <!-- Pokemon on hand (replaces this node and everything beneath it) -->
                <div v-if="node.type === 'owned'" class="border-2 rounded-xl p-3 w-64 shadow-xl bg-sky-950/60 border-sky-500">
                    <div class="flex justify-between items-center mb-1">
                        <span class="bg-sky-700 text-sky-50 text-[10px] px-2 py-0.5 rounded-full font-bold">ON HAND</span>
                        <span :class="node.gender.includes('Female') ? 'text-pink-400' : 'text-blue-400'" class="font-bold text-xs">{{ node.gender }}</span>
                    </div>
                    <div class="font-bold text-sm text-sky-200 mb-1 truncate" :title="node.species">{{ node.species }}</div>
                    <div class="bg-gray-900 rounded p-1.5 text-center font-mono text-xs font-bold text-emerald-400 mb-2 border border-gray-800 tracking-wider">
                        {{ node.ivs }}
                    </div>
                    <div class="text-xs text-gray-300 mb-2">
                        Nature: <strong :class="node.nature !== 'Any' ? 'text-amber-300' : 'text-gray-400'">{{ node.nature }}</strong>
                    </div>
                    <div v-if="node.item" class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium">
                        Holds: {{ node.item }}
                    </div>
                    <div v-else class="bg-emerald-900/30 border border-emerald-500/30 rounded p-1 text-center text-xs text-emerald-300 font-medium">
                        You already have the final Pokémon!
                    </div>
                </div>

                <!-- Leaf Node (Base Catch/Buy) -->
                <div v-if="node.type === 'leaf'" :class="isDone(node.id) ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-[#211710] border-amber-600/80'" class="border-2 rounded-xl p-3 w-64 shadow-xl transition-all duration-300">
                    <div class="flex justify-between items-center mb-1">
                        <span class="bg-amber-800/80 text-amber-100 text-[10px] px-2 py-0.5 rounded-full font-bold">CATCH / BUY</span>
                        <span :class="node.gender.includes('Female') ? 'text-pink-400' : 'text-blue-400'" class="font-bold text-xs">
                            {{ node.gender }}
                        </span>
                    </div>
                    <div class="font-bold text-sm text-amber-200 mb-1 truncate" :title="node.species">{{ node.species }}</div>
                    <div class="bg-gray-900 rounded p-1.5 text-center font-mono text-xs font-bold text-emerald-400 mb-2 border border-gray-800 tracking-wider">
                        {{ node.ivs }}
                    </div>
                    <div class="text-xs text-gray-300 mb-2">
                        Nature: <strong :class="node.nature !== 'Any' ? 'text-amber-300' : 'text-gray-400'">{{ node.nature }}</strong>
                    </div>
                    <div class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">
                        Holds: {{ node.item }}
                    </div>
                    <div class="flex items-center space-x-2 pt-2 border-t border-gray-700/50">
                        <input type="checkbox" :checked="isDone(node.id)" @change="toggle(node.id)" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="isDone(node.id) ? 'text-emerald-400' : 'text-amber-200'">Acquired</label>
                    </div>
                </div>
            </div>

            <!-- Parent Branches -->
            <div v-if="node.type === 'breed' && node.parent1 && node.parent2" v-show="!isDone(node.id)" :class="['flex relative', orientation === 'horizontal' ? 'flex-col space-y-6 tree-branch-h' : 'flex-row space-x-6 tree-branch-v']">
                <tree-node :node="node.parent1" :orientation="orientation"></tree-node>
                <tree-node :node="node.parent2" :orientation="orientation"></tree-node>
            </div>
        </div>
    `
};

const app = createApp({
    components: { TreeNode, AutoInput },
    setup() {
        let db = null;
        const dbLoaded = ref(false);
        const view = ref(window.innerWidth < 768 ? 'steps' : 'tree');
        const orientation = ref('horizontal');

        const speciesInput = ref('');
        const ivsInput = ref('');
        const natureInput = ref('');
        const powerCost = ref(10000);
        const everstoneCost = ref(5000);

        const warnings = ref([]);
        const treeData = ref(null);
        const steps = ref([]);
        const shoppingList = ref([]);
        const costBreakdown = ref(null);
        const loading = ref(false);

        const speciesNames = ref([]);
        const natureNames = NATURES;
        const visibleIds = ref([]);
        const totalNodes = ref(0);
        const notes = ref([]);
        const savings = ref(null);
        const placements = ref([]);
        let currentKey = null;

        // Pokemon on hand (kept across plans, saved in the browser)
        const onHand = ref(loadJSON(ONHAND_KEY) || []);
        const ohSpecies = ref('');
        const ohNature = ref('');
        const ohIvs = ref('');
        const ohGender = ref('Female');
        const ohQty = ref(1);
        const onHandError = ref('');

        const scale = ref(1);
        const canvas = ref(null);
        const treeEl = ref(null);

        onMounted(async () => {
            try {
                const response = await fetch('species_db.json');
                if (!response.ok) throw new Error(`HTTP ${response.status}: could not load species_db.json`);
                db = new SpeciesDB(await response.json());
                speciesNames.value = db.names();
                dbLoaded.value = true;

                // Restore the last plan so a refresh (or coming back tomorrow) picks up where you left off
                const saved = loadJSON(INPUTS_KEY);
                if (saved && saved.species) {
                    speciesInput.value = saved.species;
                    ivsInput.value = saved.ivs || '';
                    natureInput.value = saved.nature || '';
                    if (saved.power !== undefined) powerCost.value = saved.power;
                    if (saved.everstone !== undefined) everstoneCost.value = saved.everstone;
                    await generatePlan();
                }
            } catch (err) {
                warnings.value = [`Database error: ${err.message} (open the site through a web server, not by double-clicking the file)`];
            }
        });

        const price = (v, fallback) => (v === '' || v === null || Number.isNaN(Number(v)) ? fallback : Number(v));

        const generatePlan = async () => {
            if (!db) return;
            const targetName = speciesInput.value.trim();
            if (!targetName) { warnings.value = ["Please enter a species name (e.g. Larvitar)."]; return; }

            loading.value = true;
            warnings.value = [];
            try {
                const target = db.find(targetName);
                if (!target.canBreed) throw new Error(`${target.name} is in the Undiscovered egg group and can't be bred.`);

                const natureName = canonicalNature(natureInput.value);
                const config = new PricingConfig(price(powerCost.value, 10000), price(everstoneCost.value, 5000));
                const plan = buildFullPlan(db, {
                    target, ivs: parseIVs(ivsInput.value), natureName, onHand: onHand.value, config,
                });

                // Saved progress belongs to the plan (species + IVs + nature), not to your Pokemon on hand
                const key = `${PROGRESS_PREFIX}${target.identifier}|${plan.root.traits.join(',')}|${(natureName || '').toLowerCase()}`;
                if (key !== currentKey) { currentKey = key; store.progress = loadJSON(key) || {}; }
                saveJSON(INPUTS_KEY, {
                    species: speciesInput.value.trim(), ivs: ivsInput.value, nature: natureInput.value.trim(),
                    power: powerCost.value, everstone: everstoneCost.value,
                });

                const costs = plan.costs;
                treeData.value = serializeTree(plan.root, plan.ctx);
                shoppingList.value = buildShoppingList(plan.root, plan.ctx);
                steps.value = renderPlan(plan.root, plan.ctx, costs.gender_costs);
                visibleIds.value = [...leaves(plan.root), ...breeds(plan.root)].map((n) => n.nodeId);
                totalNodes.value = visibleIds.value.length;

                costBreakdown.value = {
                    item_counts: costs.item_counts,
                    power_items_count: costs.power_items_count, power_unit: config.powerItemCost, power_cost: costs.power_items_cost,
                    everstones_count: costs.everstones_count, everstone_unit: config.everstoneCost, everstone_cost: costs.everstones_cost,
                    gender_lock_cost: costs.gender_lock_cost, total_cost: costs.grand_total,
                };
                placements.value = plan.placements;
                savings.value = onHand.value.length ? plan.savings : null;
                notes.value = plan.notes;
                warnings.value = plan.warnings;
            } catch (err) {
                treeData.value = null; shoppingList.value = []; steps.value = [];
                costBreakdown.value = null; placements.value = []; savings.value = null; notes.value = [];
                warnings.value = [err.message || "Failed to generate plan."];
            } finally {
                loading.value = false;
                await nextTick();
                fit();
            }
        };

        // ---- Pokemon on hand ----
        const addOnHand = () => {
            onHandError.value = '';
            try {
                if (!db) throw new Error('Database is still loading.');
                if (!ohSpecies.value.trim()) throw new Error('Enter a species.');
                const entry = {
                    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    species: ohSpecies.value.trim(), nature: ohNature.value.trim(), ivs: ohIvs.value.trim(),
                    gender: ohGender.value, qty: Math.max(1, parseInt(ohQty.value) || 1),
                };
                const [u] = expandOnHand(db, [entry]);   // throws a readable error if anything is off
                onHand.value.push({ ...entry, species: u.name, nature: u.nature || '', ivs: formatIVs(u.traits) });
                ohSpecies.value = ''; ohNature.value = ''; ohIvs.value = ''; ohQty.value = 1;
            } catch (err) {
                onHandError.value = err.message;
            }
        };
        const removeOnHand = (id) => { onHand.value = onHand.value.filter((p) => p.id !== id); };
        const clearOnHand = () => { if (confirm('Remove all Pokémon on hand?')) onHand.value = []; };
        const onHandTotal = () => onHand.value.reduce((n, p) => n + p.qty, 0);
        const statusFor = (entry) => {
            const mine = placements.value.filter((p) => p.entryId === entry.id);
            if (!mine.length) return { used: false, lines: [treeData.value ? 'Not used' : 'Generate a plan to see where it goes'] };
            const used = mine.filter((p) => p.placed);
            const lines = used.map((p) => p.where);
            if (mine.length > used.length) lines.push(`${mine.length - used.length} unused (doesn't fit this plan)`);
            return { used: used.length > 0, lines };
        };

        const fit = async () => {
            if (view.value !== 'tree') return;
            scale.value = 1;
            await nextTick();
            const c = canvas.value, t = treeEl.value;
            if (!c || !t) return;
            const s = Math.min((c.clientWidth - 16) / t.scrollWidth, (c.clientHeight - 16) / t.scrollHeight);
            scale.value = Math.max(0.25, Math.min(1, s));
        };
        const zoomBy = (d) => { scale.value = Math.max(0.25, Math.min(1.5, +(scale.value + d).toFixed(2))); };

        let drag = null;
        const onDown = (e) => {
            if (view.value !== 'tree' || e.button !== 0 || e.target.closest('input,label,button')) return;
            const c = canvas.value;
            drag = { x: e.clientX, y: e.clientY, l: c.scrollLeft, t: c.scrollTop };
            c.classList.add('grabbing');
        };
        const onMove = (e) => {
            if (!drag) return;
            canvas.value.scrollLeft = drag.l - (e.clientX - drag.x);
            canvas.value.scrollTop = drag.t - (e.clientY - drag.y);
        };
        const onUp = () => { drag = null; if (canvas.value) canvas.value.classList.remove('grabbing'); };

        const fmtCost = (c) => (c === null ? '(IMPOSSIBLE)' : (c ? `($${c.toLocaleString()})` : ''));

        watch([orientation, view], async () => { await nextTick(); fit(); });

        // Persist every checkbox change for the current plan
        watch(() => store.progress, (p) => { if (currentKey) saveJSON(currentKey, p); }, { deep: true });

        const doneCount = () => visibleIds.value.filter((id) => store.progress[id]).length;

        // Re-plan (and save) whenever the Pokemon on hand change
        watch(onHand, (v) => { saveJSON(ONHAND_KEY, v); if (db && treeData.value) generatePlan(); }, { deep: true });
        const resetProgress = () => {
            if (confirm('Clear all progress on this plan?')) store.progress = {};
        };

        return {
            dbLoaded, view, orientation, speciesInput, ivsInput, natureInput, powerCost, everstoneCost,
            warnings, treeData, steps, shoppingList, costBreakdown, loading, generatePlan,
            store, speciesNames, natureNames, totalNodes, doneCount, resetProgress, notes, savings,
            onHand, ohSpecies, ohNature, ohIvs, ohGender, ohQty, onHandError,
            addOnHand, removeOnHand, clearOnHand, onHandTotal, statusFor,
            scale, canvas, treeEl, fit, zoomBy, onDown, onMove, onUp, fmtCost,
        };
    }
});

app.mount('#app');