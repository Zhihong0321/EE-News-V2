# GEMS Dropdown Troubleshooting

## Issue: No GEMS showing in dropdown

### Quick Test

Run this command to test the GEMS API:
```bash
node test_gems_endpoint.js
```

This will show you:
- Raw API response
- Available GEMS
- Formatted data for dropdown

### Expected Output

You should see 2 GEMS:
1. **news-search** - `https://gemini.google.com/gem/c9d02eab1195`
2. **rewriter** - `https://gemini.google.com/gem/ba97012d9ebf`

### Check Browser Console

1. Open `/manage-task` page
2. Open browser DevTools (F12)
3. Look for console logs:
   - `GEMS API response:` - Shows the API response
   - `Available GEMS:` - Shows parsed GEMS data

### Common Issues

#### 1. GEMINI_API_URL not set
**Symptom**: API call fails or returns error

**Solution**: Check your `.env` file has:
```
GEMINI_API_URL=https://ee-gemini-api-production.up.railway.app
```

#### 2. API server is down
**Symptom**: Network error in console

**Solution**: Test the API directly:
```bash
curl https://ee-gemini-api-production.up.railway.app/gems
```

#### 3. CORS issues (local development)
**Symptom**: CORS error in browser console

**Solution**: Make sure your local server is running and proxying the API correctly.

#### 4. Empty gems array
**Symptom**: Dropdown shows "No GEMS available"

**Solution**: 
- Check if the API is returning data
- Verify the GEMS have valid URLs
- Check server logs for filtering issues

### Manual Testing

Test the endpoint directly:
```bash
# Test from your server
curl http://localhost:3000/api/gems

# Should return:
{
  "success": true,
  "gems": [
    {
      "name": "news-search",
      "url": "https://gemini.google.com/gem/c9d02eab1195",
      "description": "",
      "raw_id": "https://gemini.google.com/gem/c9d02eab1195"
    },
    {
      "name": "rewriter",
      "url": "https://gemini.google.com/gem/ba97012d9ebf",
      "description": "",
      "raw_id": "https://gemini.google.com/gem/ba97012d9ebf"
    }
  ]
}
```

### Debugging Steps

1. **Check server logs** - Look for "List GEMS error"
2. **Check browser console** - Look for fetch errors
3. **Test API directly** - Use curl or browser
4. **Verify environment** - Check GEMINI_API_URL is set
5. **Rebuild frontend** - Run `npm run build`

### Still Not Working?

If GEMS still don't show:
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R)
3. Check Network tab in DevTools for `/api/gems` request
4. Verify response status is 200
5. Check response body has `success: true` and `gems` array

### Fallback Option

If the dropdown doesn't work, you can still manually enter a GEMS URL by:
1. Temporarily using the old text input (if needed)
2. Or leave it empty to use the default GEMS

### Default GEMS

If no GEMS is selected, the system uses:
- **Headline Fetcher**: `news-search` GEMS
- **Rewriter**: `rewriter` GEMS (hardcoded in newsRewriter.js)
