import { buildTree, costReport, SpeciesDB, assignSpecies, renderPlan } from './breeding.js';

const { createApp, ref, watch, nextTick, onMounted } = Vue;

const POWER_ITEM_MAP = {
    'HP': 'Power Weight (HP)',
    'ATK': 'Power Bracer (Atk)',
    'DEF': 'Power Belt (Def)',
    'SPA': 'Power Lens (SpA)',
    'SPD': 'Power Band (SpD)',
    'SPE': 'Power Anklet (Spe)'
};

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
                    <div class="bg-gray-900 rounded p-1.5 text-center font-mono text-xs font-bold text-emerald-400 mb-2 border border-gray-800">
                        {{ node.ivs }}
                    </div>
                    <div class="text-xs text-gray-300 mb-2 flex justify-between">
                        <span>Nature: <strong :class="node.nature !== 'Any' ? 'text-amber-300' : 'text-gray-400'">{{ node.nature }}</strong></span>
                    </div>
                    <div v-if="node.held_item && node.held_item !== 'None'" class="bg-purple-900/40 border border-purple-500/50 rounded p-1 text-center text-xs text-purple-300 font-medium mb-2">
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
                    <div class="bg-gray-900 rounded p-1.5 text-center font-mono text-xs font-bold text-emerald-400 mb-2 border border-gray-800">
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
                if (!response.ok) throw new Error(`HTTP ${response.status}: Could not load species_db.json`);
                const data = await response.json();
                db = new SpeciesDB(data);
                dbLoaded.value = true;
            } catch (err) {
                warnings.value = [`Database Error: ${err.message}`];
            }
        });

        const getLeft = (n) => n ? (n.left || n.parent1 || n.parent_1 || n.p1 || (n.children && n.children[0]) || null) : null;
        const getRight = (n) => n ? (n.right || n.parent2 || n.parent_2 || n.p2 || (n.children && n.children[1]) || null) : null;

        const getEggGroupsStr = (spObj) => {
            if (!spObj) return '';
            const raw = spObj.egg_groups || spObj.egg_group || spObj.groups || spObj.eggGroups || spObj.eggGroup;
            if (Array.isArray(raw)) return raw.join(' / ');
            if (typeof raw === 'string') return raw;
            return '';
        };

        const parseIVs = (str) => {
            if (!str || !str.trim()) return ['hp', 'atk', 'def', 'spd', 'spe'];
            const parts = str.split('/').map(p => p.trim().toLowerCase());
            const ivKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
            if (parts.length === 6) {
                return ivKeys.filter((_, idx) => parts[idx] === '31');
            }
            return ivKeys.filter(k => str.toLowerCase().includes(k));
        };

        const extractIVs = (node) => {
            if (!node) return [];
            let raw = node.ivs || node.stats || node.iv_set || node.passed_ivs || node.iv_list || node.iv;
            
            if (raw instanceof Set) {
                raw = Array.from(raw);
            }
            
            if (Array.isArray(raw)) {
                return raw.map(s => String(s).toUpperCase());
            }
            
            if (raw && typeof raw === 'object') {
                const stats = [];
                const validStats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
                for (const k of Object.keys(raw)) {
                    if (validStats.includes(k.toLowerCase()) && raw[k]) {
                        stats.push(k.toUpperCase());
                    }
                }
                if (stats.length > 0) return stats;
            }
            
            if (typeof raw === 'string' && raw.trim()) {
                if (raw.includes('/')) {
                    const parts = raw.split('/').map(p => p.trim());
                    const statKeys = ['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'];
                    if (parts.length === 6) {
                        const result = [];
                        parts.forEach((val, idx) => {
                            if (val === '31' || val.toLowerCase() === 'v') result.push(statKeys[idx]);
                        });
                        if (result.length > 0) return result;
                    }
                    return parts.filter(p => p.toLowerCase() !== 'x' && p.toLowerCase() !== 'any').map(p => p.toUpperCase());
                }
                if (raw.toLowerCase() !== 'any') {
                    return [raw.toUpperCase()];
                }
            }
            
            return [];
        };

        const formatIVDisplay = (node) => {
            const ivList = extractIVs(node);
            if (ivList.length === 0) return 'Any IVs';
            return ivList.map(stat => `31 ${stat}`).join(' / ');
        };

        const getNodeItem = (node) => {
            if (!node) return 'None';

            const explicit = node.item || node.held_item || node.hold || node.power_item;
            if (typeof explicit === 'string' && explicit.trim() && explicit !== 'None') {
                return explicit;
            }

            if (node.nature === true || node.is_nature || node.has_nature || node.nature_source || node.is_nature_source) {
                return 'Everstone';
            }

            const ivs = extractIVs(node);
            if (ivs.length === 1 && POWER_ITEM_MAP[ivs[0]]) {
                return POWER_ITEM_MAP[ivs[0]];
            }

            return 'None';
        };

        const getNodeNature = (node, userNature) => {
            if (!userNature) return 'Any';

            if (typeof node.nature === 'string' && node.nature.trim() && node.nature !== 'Any' && node.nature !== 'false') {
                return node.nature;
            }

            if (node.nature === true || node.is_nature || node.has_nature || node.nature_source || node.is_nature_source) {
                return userNature;
            }

            const item = getNodeItem(node);
            if (item === 'Everstone') {
                return userNature;
            }

            return 'Any';
        };

        const formatTreeNode = (node, targetSpeciesObj, isMainLine = true, depth = 0) => {
            if (!node) return null;

            const left = getLeft(node);
            const right = getRight(node);
            const isLeaf = node.is_leaf || node.isLeaf || (!left && !right);

            const targetName = targetSpeciesObj.name || 'Target';
            const eggGroupsStr = getEggGroupsStr(targetSpeciesObj);

            let speciesName = isMainLine ? targetName : (eggGroupsStr ? `Any (${eggGroupsStr})` : 'Any (Egg Group)');
            
            let genderDisplay = 'Any Gender';
            if (depth > 0) {
                genderDisplay = isMainLine ? 'Female ♀' : 'Male ♂';
            } else if (isMainLine) {
                genderDisplay = 'Female ♀';
            }

            const formattedIVs = formatIVDisplay(node);
            const nature = getNodeNature(node, natureInput.value.trim());
            const item = getNodeItem(node);

            if (isLeaf) {
                return {
                    type: 'leaf',
                    species: speciesName,
                    gender: genderDisplay,
                    ivs: formattedIVs,
                    nature: nature,
                    item: item,
                    bought: false
                };
            }

            return {
                type: 'breed',
                species: speciesName,
                gender: genderDisplay,
                ivs: formattedIVs,
                nature: nature,
                held_item: item,
                bred: false,
                parent1: formatTreeNode(left, targetSpeciesObj, true, depth + 1),
                parent2: formatTreeNode(right, targetSpeciesObj, false, depth + 1)
            };
        };

        const extractShoppingList = (node, targetSpeciesObj, isMainLine = true, depth = 0) => {
            if (!node) return [];
            const left = getLeft(node);
            const right = getRight(node);
            const isLeaf = node.is_leaf || node.isLeaf || (!left && !right);

            if (isLeaf) {
                const targetName = targetSpeciesObj.name || 'Target';
                const eggGroupsStr = getEggGroupsStr(targetSpeciesObj);

                const speciesName = isMainLine ? targetName : (eggGroupsStr ? `Any (${eggGroupsStr})` : 'Any (Egg Group)');
                const genderDisplay = isMainLine ? 'Female ♀' : 'Male ♂';
                const formattedIVs = formatIVDisplay(node);
                const nature = getNodeNature(node, natureInput.value.trim());
                const item = getNodeItem(node);

                return [{
                    species: speciesName,
                    gender: genderDisplay,
                    ivs: formattedIVs,
                    nature: nature,
                    item: item
                }];
            }
            return [
                ...extractShoppingList(left, targetSpeciesObj, true, depth + 1),
                ...extractShoppingList(right, targetSpeciesObj, false, depth + 1)
            ];
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
            
            const targetName = speciesInput.value.trim();
            if (!targetName) {
                warnings.value = ["Please enter a species name (e.g., Larvitar)."];
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

                treeData.value = formatTreeNode(root, targetSpecies);
                
                const rawLeaves = extractShoppingList(root, targetSpecies);
                shoppingList.value = groupShoppingList(rawLeaves);

                const eggGroupsStr = getEggGroupsStr(targetSpecies);

                steps.value = rawPlan.map((s, idx) => {
                    return {
                        step: idx + 1,
                        done: false,
                        parent_1: `${hatch.name} (Female ♀)`,
                        parent_1_ivs: s.parent1_ivs ? (Array.isArray(s.parent1_ivs) ? s.parent1_ivs.map(i => `31 ${String(i).toUpperCase()}`).join(' / ') : s.parent1_ivs) : '31 IV',
                        parent_1_src: s.parent1_src || 'Catch/Buy',
                        item_p1: s.item_p1 || s.item_parent1 || 'None',
                        parent_2: `Any (${eggGroupsStr || 'Egg Group'}) (Male ♂)`,
                        parent_2_ivs: s.parent2_ivs ? (Array.isArray(s.parent2_ivs) ? s.parent2_ivs.map(i => `31 ${String(i).toUpperCase()}`).join(' / ') : s.parent2_ivs) : '31 IV',
                        parent_2_src: s.parent2_src || 'Catch/Buy',
                        item_p2: s.item_p2 || s.item_parent2 || 'None',
                        child_ivs: s.child_ivs ? (Array.isArray(s.child_ivs) ? s.child_ivs.map(i => `31 ${String(i).toUpperCase()}`).join(' / ') : s.child_ivs) : 'Any IVs',
                        child_nature: natureName || s.child_nature || 'Any',
                        child_gender: idx === rawPlan.length - 1 ? 'Female ♀ or Male ♂' : 'Female ♀',
                        gender_cost: s.gender_cost || s.gender_lock_cost || 0
                    };
                });

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