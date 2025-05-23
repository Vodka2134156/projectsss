const axios = require('axios');

function stripChainPrefix(poolId) {
  return poolId.includes('_') ? poolId.split('_')[1] : poolId;
}

async function getTokenATHMarketCap(tokenAddress, network = 'solana') {
  try {
    // Step 1: Get the most active pool for the token
    const poolsUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}/pools?sort=h24_volume_usd_desc`;
    const poolsRes = await axios.get(poolsUrl);
    const poolList = poolsRes.data?.data;

    if (!Array.isArray(poolList) || poolList.length === 0) {
      throw new Error('No pools found for this token.');
    }

    let poolId = stripChainPrefix(poolList[0].id);

    // Step 2: Get token metadata (for total supply & decimals)
    const tokenMetaUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}`;
    const tokenMetaRes = await axios.get(tokenMetaUrl);
    const tokenAttributes = tokenMetaRes.data?.data?.attributes;

    if (!tokenAttributes?.total_supply || !tokenAttributes?.decimals) {
      throw new Error('Token metadata not available.');
    }

    const totalSupply = Number(tokenAttributes.total_supply);
    const decimals = Number(tokenAttributes.decimals);
    const normalizedSupply = totalSupply / Math.pow(10, decimals);

    // Step 3: Fetch OHLCV data for the selected pool
    const ohlcvUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolId}/ohlcv/day?limit=100&currency=usd`;
    const ohlcvRes = await axios.get(ohlcvUrl);
    const ohlcvList = ohlcvRes.data?.data?.attributes?.ohlcv_list;

    if (!Array.isArray(ohlcvList) || ohlcvList.length === 0) {
      throw new Error('No OHLCV data found.');
    }

    const athPrice = ohlcvList.reduce((max, candle) => Math.max(max, candle[2]), 0); // candle[2] = high
    const athMarketCap = athPrice * normalizedSupply;

    return `$${athMarketCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  } catch (err) {
    console.error("ATH Market Cap fetch error:", err.message);
    return "❌ Failed to retrieve ATH Market Cap";
  }
}

// Example usage:
getTokenATHMarketCap('H4phNbsqjV5rqk8u6FUACTLB6rNZRTAPGnBb8KXJpump', 'solana').then(console.log);
