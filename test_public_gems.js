/**
 * Test Public GEMS from Another Account
 * Testing customer-service GEMS
 */

const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://ee-gemini-api-production.up.railway.app';

async function testPublicGems() {
    console.log('🔍 Testing Public GEMS: customer-service\n');
    
    // First, let's check if it's in the GEMS list
    console.log('Step 1: Checking available GEMS...');
    try {
        const gemsResponse = await fetch(`${GEMINI_API_URL}/gems`);
        const gemsData = await gemsResponse.json();
        
        const customerServiceGem = gemsData.merged?.find(g => g.name.toLowerCase() === 'customer-service');
        
        if (customerServiceGem) {
            console.log('✅ Found customer-service GEMS:');
            console.log(`   Name: ${customerServiceGem.name}`);
            console.log(`   URL: ${customerServiceGem.id}`);
            console.log(`   Description: ${customerServiceGem.desc || '(none)'}`);
        } else {
            console.log('❌ customer-service GEMS not found in list');
            console.log('Available GEMS:', gemsData.merged?.map(g => g.name).join(', '));
        }
    } catch (error) {
        console.error('❌ Error fetching GEMS list:', error.message);
    }
    
    // Now test calling the GEMS
    console.log('\n' + '='.repeat(60));
    console.log('Step 2: Testing chat with customer-service GEMS...\n');
    
    const testMessages = [
        'Hello, I need help with my order',
        'What are your business hours?',
        'Can you help me track my package?'
    ];
    
    for (let i = 0; i < testMessages.length; i++) {
        const message = testMessages[i];
        console.log(`\nTest ${i + 1}: "${message}"`);
        console.log('-'.repeat(60));
        
        try {
            const response = await fetch(`${GEMINI_API_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    system_prompt: 'https://gemini.google.com/gem/551b73790800' // Customer-Service GEMS
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.log(`❌ HTTP ${response.status}: ${errorText}`);
                continue;
            }
            
            const data = await response.json();
            console.log('✅ Response received:');
            console.log(`   ${data.response || data.message || '(empty response)'}`);
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
        
        // Wait a bit between requests
        if (i < testMessages.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Test completed!');
}

// Run the test
testPublicGems().catch(console.error);
