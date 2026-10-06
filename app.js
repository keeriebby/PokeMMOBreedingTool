import { buildTree, costReport, SpeciesDB, assignSpecies, renderPlan } from './breeding.js';

const { createApp, ref, watch, nextTick, onMounted } = Vue;

const TreeNode = {
    name: 'TreeNode',
    props: ['node', 'orientation'],
    template: `
        <div :class="['flex items-center justify-center', orientation === 'horizontal' ? 'flex-row space-x-12' : 'flex-col space-y-12']">
            <div class="relative">
                <div v-if="node.type === 'breed'" :class="node.bred ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-gray-800 border-gray-700'" class="border-2 rounded-xl p-3 w-56 shadow-xl transition-all duration-300">
                    <div class="flex justify-between items-center mb-2 gap-2">
                        <span class="font-bold text-sm text-gray-200">{{ node.species }}</span>
                        <span class="text-[10px] bg-gray-900 text-gray-400 px-1.5 py-0.5 rounded shrink-0">Bred</span>
                    </div>
                    <div class="bg-gray-900 rounded p-1 text-center font-mono text-xs text-emerald-400 mb-2">{{ node.ivs }}</div>
                    <div class="text-xs text-gray-400 mb-2 italic">{{ node.nature }}</div>
                    <div v-if="node.held_item" class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">Holds: {{ node.held_item }}</div>
                    <div v-else class="bg-emerald-900/40 border border-emerald-500/50 rounded p-1 text-center text-xs text-emerald-300 font-medium mb-2">Final Pokémon</div>
                    <div class="flex items-center space-x-2 pt-2 border-t border-gray-700">
                        <input type="checkbox" v-model="node.bred" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="node.bred ? 'text-emerald-400' : 'text-gray-300'">Done (collapse parents)</label>
                    </div>
                </div>

                <div v-if="node.type === 'leaf'" :class="node.bought ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-[#261c10] border-amber-600'" class="border-2 rounded-xl p-3 w-56 shadow-xl transition-all duration-300">
                    <div class="inline-block bg-emerald-800 text-white text-[10px] px-2 py-0.5 rounded-full font-bold mb-1">PURCHASE / CATCH</div>
                    <div class="font-bold text-sm text-gray-100 mb-1">{{ node.species }}</div>
                    <div class="bg-gray-900 rounded p-1 text-center font-mono text-xs text-emerald-400 mb-2">{{ node.ivs }}</div>
                    <div class="text-xs text-gray-300 mb-2">{{ node.nature }}</div>
                    <div class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">Holds: {{ node.item }}</div>
                    <div class="flex items-center space-x-2 pt-2 border-t border-gray-700/50">
                        <input type="checkbox" v-model="node.bought" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="node.bought ? 'text-emerald-400' : 'text-amber-200'">Bought</label>
                    </div>
                </div>
            </div>

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
        const speciesInput = ref('tyranitar');
        const ivsInput = ref('31/31/31/x/31/31');
        const natureInput = ref('adamant');
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
                if (!response.ok) throw new Error(`HTTP ${response.status}: Could not load species_db.json`);
                const data = await response.json();
                db = new SpeciesDB(data);
                dbLoaded.value = true;
                generatePlan();
            } catch (err) {
                warnings.value = [`Database Error: ${err.message}`];
            }
        });

        const parseIVs = (str) => {
            const parts = str.split('/').map(p => p.trim().toLowerCase());
            const ivKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
            if (parts.length === 6) {
                return ivKeys.filter((_, idx) => parts[idx] === '31');
            }
            return ['hp', 'atk', 'def', 'spd', 'spe'];
        };

        const formatTreeNode = (node) => {
            if (!node) return null;
            const ivStr = node.ivs ? node.ivs.map(i => i.toUpperCase()).join('/') : 'Any';
            if (node.is_leaf || node.left === null) {
                return {
                    type: 'leaf',
                    species: node.species ? node.species.name : 'Fodder',
                    ivs: ivStr,
                    nature: node.nature || 'Any',
                    item: node.item || 'None',
                    bought: false
                };
            }
            return {
                type: 'breed',
                species: node.species ? node.species.name : 'Target',
                ivs: ivStr,
                nature: node.nature || 'Any',
                held_item: node.item || null,
                bred: false,
                parent1: formatTreeNode(node.left),
                parent2: formatTreeNode(node.right)
            };
        };

        const extractShoppingList = (node) => {
            if (!node) return [];
            if (node.is_leaf || node.left === null) {
                const ivStr = node.ivs ? node.ivs.map(i => i.toUpperCase()).join('/') : '31 IV';
                return [{
                    species: node.species ? node.species.name : 'Fodder',
                    gender: node.gender || 'Any',
                    ivs: ivStr,
                    nature: node.nature || 'Any',
                    item: node.item || 'None'
                }];
            }
            return [...extractShoppingList(node.left), ...extractShoppingList(node.right)];
        };

        const groupShoppingList = (items) => {
            const map = new Map();
            items.forEach(item => {
                const key = `${item.species}|${item.gender}|${item.ivs}|${item.nature}|${item.item}`;
                if (!map.has(key)) {
                    map.set(key, { ...item, count: 1 });
                } else {
                    map.get(key).count++;
                }
            });
            return Array.from(map.values());
        };

        const generatePlan = async () => {
            if (!db) return;
            loading.value = true;
            warnings.value = [];

            try {
                const targetName = speciesInput.value.trim();
                const targetSpecies = db.find(targetName);
                const requestedIVs = parseIVs(ivsInput.value);
                const wantNature = !!natureInput.value.trim();
                const natureName = wantNature ? natureInput.value.trim() : null;

                const root = buildTree(requestedIVs, wantNature);
                const hatch = db.hatchSpecies(targetSpecies);
                const fodder = db.pickFodder(targetSpecies);
                assignSpecies(root, hatch, fodder);

                const costs = costReport(root);
                const rawPlan = renderPlan(root, hatch.name, natureName, costs.gender_costs, fodder.name);

                treeData.value = formatTreeNode(root);
                
                steps.value = rawPlan.map((s, idx) => ({
                    step: idx + 1,
                    done: false,
                    parent_1: s.parent1.species || hatch.name,
                    parent_1_ivs: s.parent1.ivs.join('/'),
                    parent_1_src: s.parent1.source || 'Catch/Buy',
                    item_p1: s.parent1.item || 'None',
                    parent_2: s.parent2.species || fodder.name,
                    parent_2_ivs: s.parent2.ivs.join('/'),
                    parent_2_src: s.parent2.source || 'Catch/Buy',
                    item_p2: s.parent2.item || 'None',
                    child_ivs: s.child.ivs.join('/'),
                    child_nature: s.child.nature || 'Any',
                    child_gender: s.child.gender || 'Any',
                    gender_cost: s.gender_cost || 0
                }));

                const rawLeaves = extractShoppingList(root);
                shoppingList.value = groupShoppingList(rawLeaves);

                const powerCount = costs.power_items_count || 0;
                const everCount = costs.everstones_count || 0;
                const pCostTotal = powerCount * powerCost.value;
                const eCostTotal = everCount * everstoneCost.value;
                const totalCalculatedCost = pCostTotal + eCostTotal + costs.gender_lock_cost;

                costBreakdown.value = {
                    item_counts: {
                        "Power Items": powerCount,
                        "Everstones": everCount
                    },
                    power_items_count: powerCount,
                    power_unit: powerCost.value,
                    power_cost: pCostTotal,
                    everstones_count: everCount,
                    everstone_unit: everstoneCost.value,
                    everstone_cost: eCostTotal,
                    gender_lock_cost: costs.gender_lock_cost,
                    total_cost: totalCalculatedCost
                };

            } catch (err) {
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

        const fmtCost = (c) => c === null ? '(IMPOSSIBLE)' : (c ? `($${c.toLocaleString()})` : '');

        watch([orientation, view], async () => { await nextTick(); fit(); });

        return {
            dbLoaded, view, orientation, speciesInput, ivsInput, natureInput, powerCost, everstoneCost,
            warnings, treeData, steps, shoppingList, costBreakdown, loading, generatePlan,
            scale, canvas, treeEl, fit, zoomBy, onDown, onMove, onUp, fmtCost
        };
    }
});

app.mount('#app');