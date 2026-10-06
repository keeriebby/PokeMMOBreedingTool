import { buildTree, costReport, SpeciesDB, assignSpecies, renderPlan } from './breeding.js';

const { createApp, ref, watch, nextTick, onMounted } = Vue;

const TreeNode = {
    name: 'TreeNode',
    props: ['node', 'orientation'],
    template: `
        <div :class="['flex items-center justify-center', orientation === 'horizontal' ? 'flex-row space-x-12' : 'flex-col space-y-12']">
            <div class="relative">
                <!-- Breed Node -->
                <div v-if="node.type === 'breed'" :class="node.bred ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-gray-800 border-gray-700'" class="border-2 rounded-xl p-3 w-56 shadow-xl transition-all duration-300">
                    <div class="flex justify-between items-center mb-2 gap-2">
                        <span class="font-bold text-sm text-gray-200">{{ node.species }}</span>
                        <span class="text-[10px] bg-gray-900 text-gray-400 px-1.5 py-0.5 rounded shrink-0">Bred</span>
                    </div>
                    <div class="bg-gray-900 rounded p-1 text-center font-mono text-xs text-emerald-400 mb-2">{{ node.ivs }}</div>
                    <div class="text-xs text-gray-400 mb-2 italic">Nature: {{ node.nature }}</div>
                    <div v-if="node.held_item && node.held_item !== 'None'" class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">Holds: {{ node.held_item }}</div>
                    <div v-else class="bg-emerald-900/40 border border-emerald-500/50 rounded p-1 text-center text-xs text-emerald-300 font-medium mb-2">Final Target</div>
                    <div class="flex items-center space-x-2 pt-2 border-t border-gray-700">
                        <input type="checkbox" v-model="node.bred" class="rounded bg-gray-700 border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer">
                        <label class="text-xs font-semibold cursor-pointer" :class="node.bred ? 'text-emerald-400' : 'text-gray-300'">Done (collapse)</label>
                    </div>
                </div>

                <!-- Leaf Node (Base Catch/Buy) -->
                <div v-if="node.type === 'leaf'" :class="node.bought ? 'bg-emerald-950 border-emerald-500 shadow-emerald-900/40' : 'bg-[#261c10] border-amber-600'" class="border-2 rounded-xl p-3 w-56 shadow-xl transition-all duration-300">
                    <div class="inline-block bg-emerald-800 text-white text-[10px] px-2 py-0.5 rounded-full font-bold mb-1">PURCHASE / CATCH</div>
                    <div class="font-bold text-sm text-gray-100 mb-1">{{ node.species }}</div>
                    <div class="bg-gray-900 rounded p-1 text-center font-mono text-xs text-emerald-400 mb-2">{{ node.ivs }}</div>
                    <div class="text-xs text-gray-300 mb-2">Nature: {{ node.nature }}</div>
                    <div class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">Holds: {{ node.item }}</div>
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
                if (!response.ok) throw new Error(`HTTP ${response.status}: Could not load species_db.json`);
                const data = await response.json();
                db = new SpeciesDB(data);
                dbLoaded.value = true;
            } catch (err) {
                warnings.value = [`Database Error: ${err.message}`];
            }
        });

        // Safe helpers to resolve child nodes regardless of property naming scheme
        const getLeft = (n) => n ? (n.left || n.parent1 || n.parent_1 || n.p1 || (n.children && n.children[0]) || null) : null;
        const getRight = (n) => n ? (n.right || n.parent2 || n.parent_2 || n.p2 || (n.children && n.children[1]) || null) : null;

        const parseIVs = (str) => {
            if (!str || !str.trim()) return ['hp', 'atk', 'def', 'spd', 'spe'];
            const parts = str.split('/').map(p => p.trim().toLowerCase());
            const ivKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
            if (parts.length === 6) {
                return ivKeys.filter((_, idx) => parts[idx] === '31');
            }
            return ivKeys.filter(k => str.toLowerCase().includes(k));
        };

        const formatTreeNode = (node) => {
            if (!node) return null;

            const left = getLeft(node);
            const right = getRight(node);
            const isLeaf = node.is_leaf || node.isLeaf || (!left && !right);

            const speciesName = typeof node.species === 'object' ? (node.species?.name || 'Unknown') : (node.species || 'Fodder');

            let ivStr = 'Any';
            if (Array.isArray(node.ivs)) {
                ivStr = node.ivs.map(i => String(i).toUpperCase()).join('/');
            } else if (typeof node.ivs === 'string') {
                ivStr = node.ivs;
            }

            if (isLeaf) {
                return {
                    type: 'leaf',
                    species: speciesName,
                    ivs: ivStr || '31 IV',
                    nature: node.nature || 'Any',
                    item: node.item || node.held_item || 'None',
                    bought: false
                };
            }

            return {
                type: 'breed',
                species: speciesName,
                ivs: ivStr || 'Any',
                nature: node.nature || 'Any',
                held_item: node.item || node.held_item || null,
                bred: false,
                parent1: formatTreeNode(left),
                parent2: formatTreeNode(right)
            };
        };

        const extractShoppingList = (node) => {
            if (!node) return [];
            const left = getLeft(node);
            const right = getRight(node);
            const isLeaf = node.is_leaf || node.isLeaf || (!left && !right);

            if (isLeaf) {
                const speciesName = typeof node.species === 'object' ? (node.species?.name || 'Unknown') : (node.species || 'Fodder');
                let ivStr = '31 IV';
                if (Array.isArray(node.ivs)) {
                    ivStr = node.ivs.map(i => String(i).toUpperCase()).join('/');
                } else if (typeof node.ivs === 'string') {
                    ivStr = node.ivs;
                }
                return [{
                    species: speciesName,
                    gender: node.gender || 'Any',
                    ivs: ivStr,
                    nature: node.nature || 'Any',
                    item: node.item || node.held_item || 'None'
                }];
            }
            return [...extractShoppingList(left), ...extractShoppingList(right)];
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

        const extractParent = (s, pNum) => {
            if (!s) return { species: '', ivs: '', source: 'Catch/Buy', item: 'None' };
            const pObj = pNum === 1 ? (s.parent1 || s.parent_1 || s.p1) : (s.parent2 || s.parent_2 || s.p2);
            if (pObj && typeof pObj === 'object') {
                const ivs = Array.isArray(pObj.ivs) ? pObj.ivs.join('/') : (pObj.ivs || '');
                return {
                    species: typeof pObj.species === 'object' ? (pObj.species?.name || '') : (pObj.species || pObj.name || ''),
                    ivs: ivs,
                    source: pObj.source || pObj.from || 'Catch/Buy',
                    item: pObj.item || pObj.held_item || 'None'
                };
            }
            const pPrefix = pNum === 1 ? 'parent1' : 'parent2';
            const altPrefix = pNum === 1 ? 'parent_1' : 'parent_2';
            const species = s[`${pPrefix}_species`] || s[`${altPrefix}_species`] || s[pPrefix] || s[altPrefix] || '';
            const ivsRaw = s[`${pPrefix}_ivs`] || s[`${altPrefix}_ivs`] || '';
            const ivs = Array.isArray(ivsRaw) ? ivsRaw.join('/') : ivsRaw;
            const source = s[`${pPrefix}_src`] || s[`${altPrefix}_src`] || 'Catch/Buy';
            const item = s[`item_p${pNum}`] || s[`item_${pPrefix}`] || 'None';
            return { species, ivs, source, item };
        };

        const extractChild = (s) => {
            if (!s) return { ivs: '', nature: 'Any', gender: 'Any' };
            if (s.child && typeof s.child === 'object') {
                const ivs = Array.isArray(s.child.ivs) ? s.child.ivs.join('/') : (s.child.ivs || '');
                return {
                    ivs: ivs,
                    nature: s.child.nature || 'Any',
                    gender: s.child.gender || 'Any'
                };
            }
            const ivsRaw = s.child_ivs || s.ivs || '';
            const ivs = Array.isArray(ivsRaw) ? ivsRaw.join('/') : ivsRaw;
            return {
                ivs: ivs,
                nature: s.child_nature || s.nature || 'Any',
                gender: s.child_gender || s.gender || 'Any'
            };
        };

        const generatePlan = async () => {
            if (!db) return;
            
            const targetName = speciesInput.value.trim();
            if (!targetName) {
                warnings.value = ["Please enter a species name (e.g., Larvitar or Tyranitar)."];
                return;
            }

            loading.value = true;
            warnings.value = [];

            try {
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
                
                steps.value = rawPlan.map((s, idx) => {
                    const p1 = extractParent(s, 1);
                    const p2 = extractParent(s, 2);
                    const child = extractChild(s);
                    return {
                        step: idx + 1,
                        done: false,
                        parent_1: p1.species || hatch.name,
                        parent_1_ivs: p1.ivs,
                        parent_1_src: p1.source,
                        item_p1: p1.item,
                        parent_2: p2.species || fodder.name,
                        parent_2_ivs: p2.ivs,
                        parent_2_src: p2.source,
                        item_p2: p2.item,
                        child_ivs: child.ivs,
                        child_nature: child.nature,
                        child_gender: child.gender,
                        gender_cost: s.gender_cost || s.gender_lock_cost || 0
                    };
                });

                const rawLeaves = extractShoppingList(root);
                shoppingList.value = groupShoppingList(rawLeaves);

                const powerCount = costs.power_items_count || 0;
                const everCount = costs.everstones_count || 0;
                const pCostTotal = powerCount * (powerCost.value || 0);
                const eCostTotal = everCount * (everstoneCost.value || 0);
                const totalCalculatedCost = pCostTotal + eCostTotal + (costs.gender_lock_cost || 0);

                costBreakdown.value = {
                    item_counts: {
                        "Power Items": powerCount,
                        "Everstones": everCount
                    },
                    power_items_count: powerCount,
                    power_unit: powerCost.value || 0,
                    power_cost: pCostTotal,
                    everstones_count: everCount,
                    everstone_unit: everstoneCost.value || 0,
                    everstone_cost: eCostTotal,
                    gender_lock_cost: costs.gender_lock_cost || 0,
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