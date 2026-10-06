import { buildTree, costReport, PricingConfig, SpeciesDB, assignSpecies, renderPlan } from './breeding.js';

let db = null;
const outputDiv = document.getElementById('output');
const calcBtn = document.getElementById('calcBtn');
const lockNatureCheckbox = document.getElementById('lockNature');
const natureNameInput = document.getElementById('natureName');

// Toggle the Nature text box visibility
lockNatureCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        natureNameInput.classList.remove('hidden');
    } else {
        natureNameInput.classList.add('hidden');
        natureNameInput.value = '';
    }
});

// Fetch the database on load
async function loadDatabase() {
    try {
        // Remove the leading "./" so relative pathing works cleanly across subdomains
        const response = await fetch('species_db.json'); 
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        
        db = new SpeciesDB(data);
        outputDiv.innerHTML = "<strong>Database loaded! Ready to plan.</strong>";
        calcBtn.disabled = false;
    } catch (err) {
        outputDiv.innerHTML = `<span style="color:red">Error loading database: ${err.message}</span>`;
    }
}

// Handle the calculation
calcBtn.addEventListener('click', () => {
    if (!db) return;

    try {
        const targetName = document.getElementById('targetSpecies').value.trim();
        const targetSpecies = db.find(targetName);
        
        // Gather checked IVs
        const ivs = Array.from(document.querySelectorAll('.iv-check:checked')).map(cb => cb.value);
        const wantNature = lockNatureCheckbox.checked;
        const natureName = wantNature ? (natureNameInput.value.trim() || "Any") : null;

        // Build the mathematical tree
        const root = buildTree(ivs, wantNature);
        
        // Determine species paths
        const hatch = db.hatchSpecies(targetSpecies);
        const fodder = db.pickFodder(targetSpecies);
        
        // Assign genders and species to the tree
        assignSpecies(root, hatch, fodder);
        
        // Calculate costs and generate the flat plan
        const costs = costReport(root);
        const plan = renderPlan(root, hatch.name, natureName, costs.gender_costs, fodder.name);
        
        // Format the output for the screen
        let htmlOut = `<h3>Breeding Plan for ${targetName}</h3>`;
        htmlOut += `<p><strong>Total Estimated Cost:</strong> $${costs.grand_total.toLocaleString()}</p>`;
        htmlOut += `<ul>
            <li>Power Items: ${costs.power_items_count} ($${costs.power_items_cost.toLocaleString()})</li>
            <li>Everstones: ${costs.everstones_count} ($${costs.everstones_cost.toLocaleString()})</li>
            <li>Gender Locking: $${costs.gender_lock_cost.toLocaleString()}</li>
        </ul>`;
        
        htmlOut += `<h4>Steps:</h4><pre>${JSON.stringify(plan, null, 2)}</pre>`;
        outputDiv.innerHTML = htmlOut;

    } catch (err) {
        outputDiv.innerHTML = `<span style="color:red">Error: ${err.message}</span>`;
    }
});

// Initialize
loadDatabase();