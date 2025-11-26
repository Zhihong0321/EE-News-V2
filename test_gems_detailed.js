/**
 * Detailed GEMS Testing
 * Test all available GEMS to see which ones work
 */

const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://ee-gemini-api-production.up.railway.app';

async function testGem(gemName, gemUrl) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: ${gemName}`);
    console.log(`URL: ${gemUrl}`);
    console.log('='.repeat(70));
    
    const testMessage = 'Hello, this is a test message. Please respond briefly.';
    
    try {
        console.log(`Sending: "${testMessage}"`);
        
        const response = await fetch(`${GEMINI_API_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: testMessage,
                system_prompt: gemUrl
            })
        });
        
        console.log(`Response Status: ${response.status} ${response.statusText}`);
        
        const responseText = await response.text();
        
        if (!response.ok) {
            console.log('❌ FAILED');
            console.log('Error Response:', responseText);
            return { success: false, error: responseText };
        }
        
        const data = JSON.parse(responseText);
        console.log('✅ SUCCESS');
        console.log('Response:', data.response || data.message || '(empty)');
        return { success: true, response: data };
        
    } catch (error) {
        console.log('❌ EXCEPTION');
        console.log('Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function testAllGems() {
    console.log('🔍 Testing All Available GEMS\n');
    
    // Fetch available GEMS
    console.log('Fetching GEMS list...');
    const gemsResponse = await fetch(`${GEMINI_API_URL}/gems`);
    const gemsData = await gemsResponse.json();
    const gems = gemsData.merged || [];
    
    console.log(`Found ${gems.length} GEMS:\n`);
    gems.forEach((gem, idx) => {
        console.log(`${idx + 1}. ${gem.name} - ${gem.id}`);
    });
    
    // Test each GEMS
    const results = [];
    
    for (const gem of gems) {
        const result = await testGem(gem.name, gem.id);
        results.push({
            name: gem.name,
            url: gem.id,
            ...result
        });
        
        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n✅ Working GEMS (${successful.length}):`);
    successful.forEach(r => {
        console.log(`   - ${r.name}`);
    });
    
    console.log(`\n❌ Failed GEMS (${failed.length}):`);
    failed.forEach(r => {
        console.log(`   - ${r.name}`);
        console.log(`     Error: ${r.error?.substring(0, 100)}...`);
    });
    
    console.log('\n' + '='.repeat(70));
    
    // Specific analysis for Customer-Service
    const customerService = results.find(r => r.name.toLowerCase().includes('customer'));
    if (customerService) {
        console.log('\n📋 Customer-Service GEMS Analysis:');
        console.log(`   Status: ${customerService.success ? '✅ Working' : '❌ Not Working'}`);
        console.log(`   URL: ${customerService.url}`);
        if (!customerService.success) {
            console.log(`   Issue: This GEMS is from another account (public)`);
            console.log(`   Reason: The API server may not have access to public GEMS from other accounts`);
            console.log(`   Solution: You may need to add this GEMS to your own account first`);
        }
    }
}

testAllGems().catch(console.error);
