import {
  buildTree, costReport, PricingConfig, SpeciesDB, assignSpecies, speciesWarnings,
  serializeTree, buildShoppingList, renderPlan, IV_STATS,
} from './breeding.js';

const { createApp, ref, watch, nextTick, onMounted } = Vue;

const TreeNode = {
    name: 'TreeNode',
    props: ['node', 'orientation'],
    template: `
        <div :class="['flex items-center justify-center', orientation === 'horizontal' ? 'flex-row space-x-12' : 'flex-col space-y-12']">
            <div class="relative">
                <!-- Breed Node -->
                <div v-if="node.type === 'breed'" :class="node.bred ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-gray-800 border-gray-700'" class="border-2 rounded-xl p-3 w-64 shadow-xl transition-all duration-300">
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
                        <input type="checkbox" v-model="node.bred" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="node.bred ? 'text-emerald-400' : 'text-gray-300'">Done (collapse parents)</label>
                    </div>
                </div>

                <!-- Leaf Node (Base Catch/Buy) -->
                <div v-if="node.type === 'leaf'" :class="node.bought ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-[#211710] border-amber-600/80'" class="border-2 rounded-xl p-3 w-64 shadow-xl transition-all duration-300">
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
                        <input type="checkbox" v-model="node.bought" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="node.bought ? 'text-emerald-400' : 'text-amber-200'">Acquired</label>
                    </div>
                </div>
            </div>

            <!-- Parent Branches -->
            <div v-if="node.type === 'breed' && node.parent1 && node.parent2" v-show="!node.bred" :class="['flex relative', orientation === 'horizontal' ? 'flex-col space-y-6 tree-branch-h' : 'flex-row space-x-6 tree-branch-v']">
                <tree-node :node="node.parent1" :orientation="orientation"></tree-node>
                <tree-node :node="node.parent2" :orientation="orientation"></tree-node>
            </div>
        </div>
    `
};

const app = createApp({
    components: { TreeNode },
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

        const scale = ref(1);
        const canvas = ref(null);
        const treeEl = ref(null);

        onMounted(async () => {
            try {
                const response = await fetch('species_db.json');
                if (!response.ok) throw new Error(`HTTP ${response.status}: could not load species_db.json`);
                db = new SpeciesDB(await response.json());
                dbLoaded.value = true;
            } catch (err) {
                warnings.value = [`Database error: ${err.message} (open the site through a web server, not by double-clicking the file)`];
            }
        });

        // "31/x/31/x/31/31" -> ['hp','def','spd','spe']. Anything other than 31 means "don't care".
        const parseIVs = (str) => {
            const parts = str.split('/').map((p) => p.trim().toLowerCase());
            if (parts.length !== 6) throw new Error("IVs need 6 slots separated by '/', e.g. 31/x/31/x/31/31");
            return IV_STATS.filter((_, i) => parts[i] === '31');
        };

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

                const natureName = natureInput.value.trim() || null;
                const root = buildTree(parseIVs(ivsInput.value), natureName !== null);
                const hatch = db.hatchSpecies(target);
                const fodder = db.pickFodder(target);
                assignSpecies(root, hatch, fodder);

                const costs = costReport(root, new PricingConfig(price(powerCost.value, 10000), price(everstoneCost.value, 5000)));
                const ctx = {
                    targetName: target.name,
                    fodderLabel: `Any (${target.eggGroups.join(' / ')})`,
                    natureName,
                };

                treeData.value = serializeTree(root, ctx);
                shoppingList.value = buildShoppingList(root, ctx);
                steps.value = renderPlan(root, ctx, costs.gender_costs).map((s) => ({ ...s, done: false }));

                costBreakdown.value = {
                    item_counts: costs.item_counts,
                    power_items_count: costs.power_items_count,
                    power_unit: price(powerCost.value, 10000),
                    power_cost: costs.power_items_cost,
                    everstones_count: costs.everstones_count,
                    everstone_unit: price(everstoneCost.value, 5000),
                    everstone_cost: costs.everstones_cost,
                    gender_lock_cost: costs.gender_lock_cost,
                    total_cost: costs.grand_total,
                };

                const w = speciesWarnings(target, hatch, fodder);
                if (costs.impossible.length) w.push(`${costs.impossible.length} breed(s) need a gender this species can't produce.`);
                warnings.value = w;
            } catch (err) {
                treeData.value = null;
                shoppingList.value = [];
                steps.value = [];
                costBreakdown.value = null;
                warnings.value = [err.message || "Failed to generate plan."];
            } finally {
                loading.value = false;
                await nextTick();
                fit();
            }
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

        return {
            dbLoaded, view, orientation, speciesInput, ivsInput, natureInput, powerCost, everstoneCost,
            warnings, treeData, steps, shoppingList, costBreakdown, loading, generatePlan,
            scale, canvas, treeEl, fit, zoomBy, onDown, onMove, onUp, fmtCost,
        };
    }
});

app.mount('#app');