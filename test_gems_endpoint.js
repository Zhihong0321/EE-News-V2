/**
 * Test GEMS endpoint formatting
 */

const GEMINI_API_URL = 'https://ee-gemini-api-production.up.railway.app';

async function testGemsEndpoint() {
    try {
        console.log('Fetching GEMS from API...');
        const response = await fetch(`${GEMINI_API_URL}/gems`);
        const data = await response.json();
        
        console.log('\n=== Raw API Response ===');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n=== Merged GEMS ===');
        const gems = data.merged || [];
        console.log(`Found ${gems.length} GEMS`);
        
        console.log('\n=== Formatted for Dropdown ===');
        const formattedGems = gems.map(gem => {
            let url = gem.id || '';
            
            if (gem.gem_id && gem.gem_id.trim()) {
                url = `https://gemini.google.com/gem/${gem.gem_id}`;
            }
            
            return {
                name: gem.name || 'Unnamed GEMS',
                url: url,
                description: gem.desc || '',
                raw_id: gem.id
            };
        }).filter(gem => gem.url);
        
        formattedGems.forEach((gem, idx) => {
            console.log(`\n${idx + 1}. ${gem.name}`);
            console.log(`   URL: ${gem.url}`);
            console.log(`   Description: ${gem.description || '(none)'}`);
        });
        
        console.log(`\n✅ Total available GEMS: ${formattedGems.length}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testGemsEndpoint();
