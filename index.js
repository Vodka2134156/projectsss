const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const { Connection, PublicKey, clusterApiUrl } =require('@solana/web3.js');
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function stripChainPrefix(poolId) {
  return poolId.includes('_') ? poolId.split('_')[1] : poolId;
}
function formatNumberShort(n) {
  if (n >= 1000000_000) {
    return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  } else if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  } else if (n >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  } else {
    return n.toString();
  }
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

    return athMarketCap.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch (err) {
    console.error("ATH Market Cap fetch error:", err.message);
    return "❌ Failed to retrieve ATH Market Cap";
  }
}



const token = '8007770170:AAHZ39EJAG-UxUAxiKeAYBW-tQUDPr0S6rk'; // Replace with your bot token
const bot = new TelegramBot(token, { polling: true });
const TOKEN_HOLDER_CALLBACK = 'show_holders'; // Custom callback ID
async function sendTokenInfoByAddress(address, chatId, bot) {
  try {

    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`;
    const response = await axios.get(url);
    const data = response.data.pairs?.[0];

    if (!data) {
      // Fallback if address ends with 'pump'
      if (address.endsWith('pump')) {
        try {
          const fallbackRes = await axios.get(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);
          const fallbackToken = fallbackRes.data?.[0];
          console.log(fallbackRes)

          if (!fallbackToken) {
            return bot.sendMessage(chatId, '❌ Token not found, even on Pump.fun fallback.');
          }
          

          const {
            baseToken,  priceUsd,url: pairUrl ,marketCap, volume,info, tokenAddress,priceChange,txns,pairCreatedAt
          } = fallbackToken;
          
          let socials = (info?.socials && Array.isArray(info.socials) && info.socials.length > 0)
          ? info.socials
              .map(s => `<a href="${s.url}">${s.type.toLowerCase() === 'twitter' ? '𝕏' : s.type.charAt(0).toUpperCase() + s.type.slice(1)}</a>`)
              .join(' | ')
          : '';
          const ageMs = Date.now() - pairCreatedAt;
          const ageMinutes = Math.floor(ageMs / (1000 * 60));
          let ageString;
          
          if (ageMinutes < 60) {
            ageString = `${ageMinutes}m`;
          } else if (ageMinutes < 1440) {
            ageString = `${Math.floor(ageMinutes / 60)}h`;
          } else {
            ageString = `${Math.floor(ageMinutes / 1440)}d`;
          }
          const message = `💊 <b>${baseToken.name}</b> ($${baseToken.symbol})
<code>${address}</code> 
└ PumpFun |age : ${ageString}

📊 Token Overview:
├ Price:  $${Number(priceUsd).toFixed(6)}
├ MC:    $${formatNumberShort(marketCap)}
├ Vol:   $${formatNumberShort(volume.h24)}

${(priceChange.h1 ?? 0) > 0 ? '📈' : '📉'} 1h: ${(priceChange.h1 ?? 0) > 0 ? '+' : ''}${(priceChange.h1 ?? 0)}% 🅑 ${(txns.h1?.buys ?? 0)} Ⓢ ${(txns.h1?.sells ?? 0)}
${(priceChange.h6 ?? 0) > 0 ? '📈' : '📉'} 6h: ${(priceChange.h6 ?? 0) > 0 ? '+' : ''}${(priceChange.h6 ?? 0)}% 🅑 ${(txns.h6?.buys ?? 0)} Ⓢ ${(txns.h6?.sells ?? 0)}
${(priceChange.h24 ?? 0) > 0 ? '📈' : '📉'} 24h: ${(priceChange.h24 ?? 0) > 0 ? '+' : ''}${(priceChange.h24 ?? 0)}% 🅑 ${(txns.h24?.buys ?? 0)} Ⓢ ${(txns.h24?.sells ?? 0)}

🔗 <a href="${pairUrl}">DexScreener</a>${baseToken.address.endsWith('pump') ? ` | <a href="https://pump.fun/coin/${baseToken.address}">Pump.Fun</a>` : ''}${socials ? ` | ${socials}` : ' | No socials found'}`;
const headerImage = info?.header || info?.imageUrl || null;
savePriceIfNotExists(chatId,address,marketCap)
const inlineKeyboard = {
  reply_markup: {
    inline_keyboard:[ [
    { text: "💊 View on Pump.fun", url: `https://pump.fun/coin/${baseToken.address}` }
  ]]}}

          if (headerImage) {
            return await bot.sendPhoto(chatId, headerImage, {
              caption: message,
             
              parse_mode: 'HTML',
              disable_web_page_preview: true,

            });}

return bot.sendMessage(chatId, message, {
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard
    
  }
});
        } catch (e) {
          console.error('Pump.fun fallback failed:', e.message);
        }
      }

      return bot.sendMessage(chatId, '❌ Token not found.');
    }

    const {
      baseToken, quoteToken, url: pairUrl, priceUsd, priceChange,
      volume, liquidity, marketCap, fdv, txns, pairCreatedAt, info
    } = data;

    const ageMs = Date.now() - pairCreatedAt;
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageString = ageHours >= 24 ? `${Math.floor(ageHours / 24)}d` : `${ageHours}h`;

    const socials = (info?.socials && Array.isArray(info.socials) && info.socials.length > 0)
  ? info.socials
      .map(s => `<a href="${s.url}">${s.type.toLowerCase() === 'twitter' ? '𝕏' : s.type.charAt(0).toUpperCase() + s.type.slice(1)}</a>`)
      .join(' | ')
  : '';

    function getChainInfo(chainName) {
      const name = chainName.toLowerCase();
      if (name.includes('sol')) return { emoji: '🟣', id: 'solana',name:"SOL" };
      if (name.includes('bnb')) return { emoji: '🟡', id: 'bsc' , name:"BSC"};
      if (name.includes('base')) return { emoji: '🔵', id: 'base',name:"BASE" };
      if (name.includes('eth') || name.includes('ethereum')) return { emoji: '⚫', id: 'eth',name:"ETH" };
      if (name.includes('trx') || name.includes('tron')) return { emoji: '🔴', id: 'tron',name:"TRON" };
      return { emoji: '🟢', id: 'unknown', name:quoteToken.name.replace(/wrapped/i, '').trim().toUpperCase()};
    }
    

    const { emoji: chainEmoji, id: chainId ,name} = getChainInfo(quoteToken.name);
    const formattedMC = formatNumberShort(marketCap);
    const formattedLP = liquidity.usd >= 1_000_000 ? `$${(liquidity.usd / 1_000_000).toFixed(1)}M` : `$${(liquidity.usd / 1000).toFixed(1)}K`;
    const formattedVl = volume.h24 >= 1_000_000 ? `$${(volume.h24 / 1_000_000).toFixed(1)}M` : `$${(volume.h24 / 1000).toFixed(1)}K`;
    console.log(chainId)
    
    const resolvedChainId = chainId === 'solana' ? 'sol' : chainId;
   
let ATH = '', athNumber = 0, mcapX = '';
try {
  ATH = await getTokenATHMarketCap(baseToken.address, chainId);
  athNumber = Number(ATH.replace(/\$/g, '').replace(/,/g, ''));
  mcapX = marketCap && athNumber && !isNaN(athNumber) ? ` [${(athNumber / marketCap).toFixed(2)}x]` : '';
} catch (e) {
  console.error("Failed to fetch ATH:", e.message);
}

let holderLine = '';
try {
  const holderInfoRes = await axios.get(`https://api.geckoterminal.com/api/v2/networks/${chainId}/tokens/${baseToken.address}/info`);
  const count = holderInfoRes?.data?.data?.attributes?.holders?.count;
  holderLine = count ? ` | TH: ${count.toLocaleString()}` : '';
} catch (e) {
  console.error('Error fetching holder count:', e.message);
}

const athLine = athNumber > 0 ? `└ ATH:   $${formatNumberShort(athNumber)}${mcapX}\n` : '';

const message = `${chainEmoji} <b>${baseToken.name}</b> ($${baseToken.symbol})
<code>${baseToken.address}</code>
└ ${name} | Age: <b>${ageString}</b>${holderLine}

📊 Token Overview:
├ Price:  $${Number(priceUsd).toFixed(6)}
├ MC:    $${formattedMC}
├ LP:    ${formattedLP}
├ Vol:   ${formattedVl}
${athLine}
${(priceChange.h1 ?? 0) > 0 ? '📈' : '📉'} 1h: ${(priceChange.h1 ?? 0) > 0 ? '+' : ''}${(priceChange.h1 ?? 0)}% 🅑 ${(txns.h1?.buys ?? 0)} Ⓢ ${(txns.h1?.sells ?? 0)}
${(priceChange.h6 ?? 0) > 0 ? '📈' : '📉'} 6h: ${(priceChange.h6 ?? 0) > 0 ? '+' : ''}${(priceChange.h6 ?? 0)}% 🅑 ${(txns.h6?.buys ?? 0)} Ⓢ ${(txns.h6?.sells ?? 0)}
${(priceChange.h24 ?? 0) > 0 ? '📈' : '📉'} 24h: ${(priceChange.h24 ?? 0) > 0 ? '+' : ''}${(priceChange.h24 ?? 0)}% 🅑 ${(txns.h24?.buys ?? 0)} Ⓢ ${(txns.h24?.sells ?? 0)}

🔗 <a href="${pairUrl}">DexScreener</a>${baseToken.address.endsWith('pump') ? ` | <a href="https://pump.fun/coin/${baseToken.address}">Pump.Fun</a>` : ''}${socials ? ` | ${socials}` : ' | No socials found'}`;
savePriceIfNotExists(chatId,address,marketCap)
const inlineKeyboard = {
  reply_markup: {
    inline_keyboard: [
      chainId === 'solana' || chainId === 'eth' || chainId === 'bsc'
        ? [
            { text: "👥", callback_data: `${TOKEN_HOLDER_CALLBACK}:${baseToken.address}:${resolvedChainId}` },
            { text: "🫧 ", callback_data: `bubblemap:${baseToken.address}:${resolvedChainId}` },
            { text: "📈 ", callback_data: `chart:${baseToken.address}:${chainId}` },
            { text: "🔄", callback_data: `refresh:${baseToken.address}:${resolvedChainId}` }
          ]
        : [
            { text: "🔄", callback_data: `refresh:${address}` }
          ]
    ]
  },
  parse_mode: 'HTML',
  disable_web_page_preview: true

};

const headerImage = info?.header || info?.imageUrl || null;

if (headerImage) {
  await bot.sendPhoto(chatId, headerImage, {
    caption: message,
    ...inlineKeyboard
  });
} else {
  await bot.sendMessage(chatId, message, {
    ...inlineKeyboard
  });
}
} catch (err) {
console.error(err);
bot.sendMessage(chatId, '⚠️ Error fetching token info.');
}
}

    bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;
    
      if (data.startsWith('refresh:')) {
        const [_, tokenAddress, chainId] = data.split(':');
        await bot.sendMessage(chatId, '♻️ Refreshing token info...');
        await sendTokenInfoByAddress(tokenAddress, chatId, bot);
       
      }
    
      if (data.startsWith('show_holders:')) {
        const [_, tokenAddress, chain] = data.split(':');
        let holdersMessage = "⚠️ Chain not supported.";
        try {
          if (chain === 'sol') holdersMessage = await getSolanaTokenHolders(tokenAddress);
          else if (chain === 'eth') holdersMessage = await getEthTokenHolders(tokenAddress);
          else if (chain === 'bsc') holdersMessage = await getBscTokenHolders(tokenAddress);
        } catch (e) {
          console.error(e);
          holdersMessage = "⚠️ Failed to fetch holders.";
        }
        await bot.sendMessage(chatId, holdersMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
    
      }
    
      if (data.startsWith('bubblemap:')) {
        const [_, tokenAddress, chainId] = data.split(':');
        
        await sendBubbleMapScreenshot(tokenAddress, chainId, chatId, bot);
       
      }
    
      if (data.startsWith('chart:')) {
        const [_, tokenAddress, chainId] = data.split(':');
        
        await sendChartMapScreenshot(tokenAddress, chainId, chatId, bot);
       
      }
    });
    
    function savePriceIfNotExists(chatId, tokenAddress, mcap) {
      let log = {};
      if (fs.existsSync(scannedTokensFile)) {
        log = JSON.parse(fs.readFileSync(scannedTokensFile, 'utf-8'));
      }
      if (!log[chatId]) log[chatId] = {};
      if (!log[chatId][tokenAddress]) {
        // On enregistre seulement si le token n'est pas déjà sauvegardé pour ce chatId
        log[chatId][tokenAddress] = { mcap };
        fs.writeFileSync(scannedTokensFile, JSON.stringify(log, null, 2));
        console.log(`Saved price for ${tokenAddress} under chatId ${chatId}: ${mcap}`);
      } else {
        console.log(`Price already saved for ${tokenAddress} under chatId ${chatId}, skipping.`);
      }
    }
    

 

  const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=e194147e-3af9-4d97-bea9-e0def734468f";
  async function getSolanaTokenMetadata(TOKEN_MINT_ADDRESS) {
    const response = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=e194147e-3af9-4d97-bea9-e0def734468f`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAccounts: [TOKEN_MINT_ADDRESS],
        includeOffChain: false,
        disableCache: false
      })
    });
  
    const data = await response.json();
  
    if (!data || !data[0]) throw new Error("Token metadata not found");
  
    const token = data[0];
    const supplyRaw = token?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.supply;
    const decimals = token?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.decimals;
    const name = token?.onChainMetadata?.metadata?.data?.name;
    const symbol = token?.onChainMetadata?.metadata?.data?.symbol;
  
    const supply = Number(supplyRaw) / Math.pow(10, decimals);
  
    return { supply, decimals, name, symbol };
  }
  
  async function getSolanaTokenHolders(TOKEN_MINT_ADDRESS) {
    const { supply, decimals, name, symbol } = await getSolanaTokenMetadata(TOKEN_MINT_ADDRESS);
  
    let page = 1;
    const allHolders = [];
  
    while (true) {
      const response = await fetch(HELIUS_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "helius-test",
          method: "getTokenAccounts",
          params: {
            page: page,
            limit: 1000,
            displayOptions: {},
            mint: TOKEN_MINT_ADDRESS,
          },
        }),
      });
  
      if (!response.ok) break;
      const data = await response.json();
      if (!data.result || data.result.token_accounts.length === 0) break;
  
      data.result.token_accounts.forEach(account => {
        const amount = account.amount / Math.pow(10, decimals);
        const percentage = (amount / supply) * 100;
  
        allHolders.push({
          owner: account.owner,
          amount,
          percentage,
        });
      });
  
      page++;
    }
  
    const sortedHolders = allHolders
      .filter(holder => holder.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  
     

      const emojiRanks = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      const title = `<b>🏆 Top 10 holders of $${symbol}</b>\n\n`;
  const htmlMessage = title + sortedHolders.map((holder, index) => {
  const shortOwner = `${holder.owner.slice(0, 4)}...${holder.owner.slice(-4)}`;
  const link = `https://solscan.io/account/${holder.owner}`;
  const emoji = emojiRanks[index] || `${index + 1}.`;
  
  return `${emoji} ${formatNumberShort(holder.amount)} (${holder.percentage.toFixed(2)}%) <a href="${link}">${shortOwner}</a>`;
}).join('\n');
  
    return `Top Holders of ${name} (${symbol}):\n\n` + htmlMessage;
  }
  
  
  async function sendBubbleMapScreenshot(tokenAddress, chainId, chatId, bot) {
    const message=await bot.sendMessage(chatId, "🧠 Generating BubbleMap...");
    const url = `https://app.bubblemaps.io/${chainId}/token/${tokenAddress}`;
    if (!['sol', 'eth', 'bsc'].includes(chainId)) {
      return bot.sendMessage(chatId,"⚠️ Chain not supported");
    }
    const filePath = `./tmp/bubblemap_${tokenAddress}.png`;
  
    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
  
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
  
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  
      // Wait and click the "Wallets List" button by text
      await page.waitForSelector('.buttons-row__button', { visible: true, timeout: 10000 });
  
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.buttons-row__button'));
        const btn = buttons.find(el => el.innerText.trim().toLowerCase().includes('wallets list'));
        if (btn) btn.click();
      });
      await page.evaluate(() => {
        const header = document.querySelector('.layout-header'); // or exact class
        if (header) header.style.display = 'none';
      });
      await page.evaluate(() => {
        const header = document.querySelector('header.mdc-top-app-bar');
        if (header) header.style.display = 'none';
      });      
  
      // Wait for wallet list to render
      // equivalent to sleep(2s)
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Screenshot the full viewport
      await page.screenshot({ path: filePath });
  
      await bot.sendPhoto(chatId, fs.createReadStream(filePath), {
        caption: `🧠 <b><a href="https://app.bubblemaps.io/eth/${chainId}/${tokenAddress}">Click here to view BubbleMap</a></b>`,
        parse_mode: 'HTML'
      });
      bot.deleteMessage(chatId, message.message_id)
  
      await browser.close();
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(err);
      await bot.sendMessage(chatId, `⚠️ Could not generate BubbleMap for ${tokenAddress}`);
    }
  }
  async function sendChartMapScreenshot(tokenAddress, chainId, chatId, bot) {

  const url = `https://www.geckoterminal.com/${chainId}/pools/${tokenAddress}`;
  console.log(chainId)
  if (!['solana', 'eth', 'bsc'].includes(chainId)) {
    return bot.sendMessage(chatId, "⚠️ Chain not supported");
  }

  const filePath = `./tmp/chart_${tokenAddress}.png`;
  const message =await bot.sendMessage(chatId, "📈 Generating chart...");

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the chart container to load (adjust the selector if needed)
    await page.waitForSelector('.bg-chart', { visible: true, timeout: 10000 });

    // Select and screenshot the chart only
    const chartElement = await page.$('.bg-chart');
    await chartElement.screenshot({ path: filePath });

    await bot.sendPhoto(chatId, fs.createReadStream(filePath), {
      caption: `📈 <b><a href="${url}">Click here to view chart</a></b>`,
      parse_mode: 'HTML'
    });

    await browser.close();
    bot.deleteMessage(chatId,message.message_id)
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, `⚠️ Could not generate Chart 📈 <b><a href="${url}">Click here to view chart</a></b>`,{parse_mode: 'HTML'});
  }
}

  
  const BITQUERY_API_KEY = "ory_at_yfi5uqo4RZ6cbKBImrIf7kzUGVFGv7EyMsGeJOLnwcE.3GXsuseul_LSd44tzE6oJCyzb9wF_Z7U39Oj7WERMTc"; // create free account at https://bitquery.io
  async function getBscTokenMetadataGecko(tokenAddress) {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress}`, {
      headers: { accept: 'application/json' }
    });
  
    const data = await res.json();
    const attr = data.data.attributes;
  
    const decimals = Number(attr.decimals);
    const totalSupply = Number(attr.total_supply) / (10 ** decimals);
    const price = Number(attr.price_usd);
    const fdv = Number(attr.fdv_usd);
    const marketCap = Number(attr.market_cap_usd);
    const name = attr.name;
    const symbol = attr.symbol;
  
    return { name, symbol, totalSupply, price, fdv, marketCap };
  }
  
  async function getBscTokenHolders(tokenAddress) {
    // Step 1: Get token metadata from GeckoTerminal
    const metaRes = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${tokenAddress}`, {
      headers: { accept: 'application/json' }
    });
  
    const metaJson = await metaRes.json();
    const attr = metaJson?.data?.attributes;
  
    if (!attr?.total_supply || !attr?.decimals) {
      throw new Error("Could not retrieve total supply or decimals");
    }
  
    const decimals = Number(attr.decimals);
    const totalSupply = Number(attr.total_supply) / (10 ** decimals);
    const symbol = attr.symbol || "TOKEN";
  
    // Step 2: Prepare dynamic date for Bitquery
    const today = new Date().toISOString().split('T')[0]; // e.g. "2025-05-02"
  
    // Step 3: Query Bitquery for top holders
    const query = `
      {
        EVM(dataset: archive, network: bsc) {
          TokenHolders(
            date: "${today}"
            tokenSmartContract: "${tokenAddress}"
            limit: { count: 10 }
            orderBy: { descending: Balance_Amount }
          ) {
            Holder {
              Address
            }
            Balance {
              Amount
            }
          }
        }
      }
    `;
  
    const res = await fetch("https://streaming.bitquery.io/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BITQUERY_API_KEY}`
      },
      body: JSON.stringify({ query })
    });
  
    const data = await res.json();
    const results = data?.data?.EVM?.TokenHolders ?? [];
  
    if (!results.length) return "❌ No holder data available today.";
  
    const emojiRanks = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const title = `<b>🏆 Top 10 holders of $${symbol}</b>\n\n`;
  
    const body = results.map((r, i) => {
      const addr = r.Holder.Address;
      const amount = r.Balance.Amount;
      const percent = ((amount / totalSupply) * 100).toFixed(2);
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      const link = `https://bscscan.com/address/${addr}`;
      const emoji = emojiRanks[i] || `${i + 1}.`;
      return `${emoji} ${formatNumberShort(amount)} (${percent}%) <a href="${link}">${short}</a>`;
    }).join('\n');
  
    return title + body;
  }
  
  
  // Optional helper
  
  async function getEthTokenHolders(tokenAddress) {
    // Step 1: Fetch metadata from GeckoTerminal
    const metaRes = await fetch(`https://api.geckoterminal.com/api/v2/networks/eth/tokens/${tokenAddress}`, {
      headers: { accept: 'application/json' }
    });
  
    const metaJson = await metaRes.json();
    const attr = metaJson?.data?.attributes;
  
    if (!attr?.total_supply || !attr?.decimals) {
      throw new Error("Could not retrieve total supply or decimals");
    }
  
    const decimals = Number(attr.decimals);
    const totalSupply = Number(attr.total_supply) / Math.pow(10, decimals);
    const symbol = attr.symbol || "TOKEN";
  
    // Step 2: Get current date for Bitquery
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
  
    // Step 3: Query Bitquery for ETH top holders
    const query = `
      {
        EVM(dataset: archive, network: eth) {
          TokenHolders(
            date: "${today}"
            tokenSmartContract: "${tokenAddress}"
            limit: { count: 10 }
            orderBy: { descending: Balance_Amount }
          ) {
            Holder {
              Address
            }
            Balance {
              Amount
            }
          }
        }
      }
    `;
  
    const res = await fetch("https://streaming.bitquery.io/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BITQUERY_API_KEY}`
      },
      body: JSON.stringify({ query })
    });
  
    const data = await res.json();
    const results = data?.data?.EVM?.TokenHolders ?? [];
  
    if (!results.length) return "❌ No ETH token holder data found.";
  
    const emojiRanks = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    const title = `<b>🏆 Top 10 holders of $${symbol}</b>\n\n`;
  
    const body = results.map((r, i) => {
      const addr = r.Holder.Address;
      const amount = r.Balance.Amount;
      const percent = ((amount / totalSupply) * 100).toFixed(2);
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      const link = `https://etherscan.io/address/${addr}`;
      const emoji = emojiRanks[i] || `${i + 1}.`;
  
      return `${emoji} ${formatNumberShort(amount)} (${percent}%) <a href="${link}">${short}</a>`;
    }).join('\n');
  
    return title + body;
  }
  
  // Number shortener
 
const scannedTokensFile = 'scanned_tokens.json';
let scannedTokens = {};
async function generatePnlImage(tokenName, multiple,color,image,state=true,mcap) {
    console.log(mcap)
    const baseImage = await loadImage(image);
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');
  
    ctx.drawImage(baseImage, 0, 0);
   
    if (state){
    ctx.font = 'bold 300px Comic Sans MS';
    let tokenText = `${tokenName}`;
    let tokenWidth = ctx.measureText(tokenText).width;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 12;
    ctx.strokeText(tokenText, canvas.width - tokenWidth - 30, 450, canvas.width - 60);
    ctx.fillText(tokenText, canvas.width - tokenWidth - 30, 450, canvas.width - 60);}
    else{
        ctx.font = 'bold 300px Comic Sans MS';
        let tokenText = `${tokenName}`;
        let tokenWidth = ctx.measureText(tokenText).width;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 12;
        ctx.strokeText(tokenText, canvas.width - tokenWidth - 30, 300, canvas.width - 60);
        ctx.fillText(tokenText, canvas.width - tokenWidth - 30, 300, canvas.width - 60);} 
    
    ctx.fillStyle = "#000000";
    ctx.font = 'bold 140px Comic Sans MS';
    let callbyText= `called at ${formatNumberShort(mcap)}`;
    let callbtWidth = ctx.measureText(callbyText).width;
    ctx.strokeText(callbyText, canvas.width - callbtWidth - 50, 500, canvas.width - 60);
    ctx.fillText(callbyText, canvas.width - callbtWidth - 50, 500, canvas.width - 60);
    ctx.fillStyle = color;
    ctx.font = 'bold 270px Comic Sans MS';
    let multipleText = `${multiple}%`;
    let multipleWidth = ctx.measureText(multipleText).width;
    ctx.strokeText(multipleText, canvas.width - multipleWidth - 50, 800, canvas.width - 60);
    ctx.fillText(multipleText, canvas.width - multipleWidth - 50, 800, canvas.width - 60);
   
  
    const buffer = canvas.toBuffer('image/png');
    const imagePath = `./pnl-${Date.now()}.png`;
    fs.writeFileSync(imagePath, buffer);
    return imagePath;
  }
// Load previously saved tokens if the file exists
if (fs.existsSync(scannedTokensFile)) {
  scannedTokens = JSON.parse(fs.readFileSync(scannedTokensFile));
}
function getSavedPrice(chatId, tokenAddress) {
    const log = JSON.parse(fs.readFileSync(scannedTokensFile));
    return log[chatId]?.[tokenAddress]?.mcap || null;
  }
  bot.onText(/\/pnl (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
  
    try {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url);
      const data = response.data.pairs?.[0];
  
      if (!data) return bot.sendMessage(chatId, '❌ Token not found.');
  
      const { baseToken, marketCap } = data;
      const oldPrice = getSavedPrice(chatId, baseToken.address);
  
      if (!oldPrice) {
        return bot.sendMessage(chatId, `📉 No previous /scan found for ${baseToken.symbol}. Try /scan first.`);
      }
      console.log(marketCap)
      const currentPrice = parseFloat(marketCap);
      const change = ((currentPrice - oldPrice) / oldPrice) * 100;
      const multiple = (currentPrice / oldPrice).toFixed(2);
      let path 
      if (change>0){
       path =await generatePnlImage(`$${baseToken.symbol}`,change.toFixed(2),"#6DFE49",'./pnl.png',false,oldPrice)}
      else{
         path =await generatePnlImage(`$${baseToken.symbol}`,change.toFixed(2),"#FF2C3A",'./pnl2.png',false,oldPrice)
      }
     
      await bot.sendPhoto(chatId,  fs.createReadStream(path), {
        caption: `📊 ${baseToken.symbol} has made ${multiple}x since your first scan.`,
      });
      fs.unlink(path, (err) => {
        if (err) {
          console.error("Erreur lors de la suppression de l'image :", err);
        } else {
          console.log("Image supprimée avec succès.");
        }
      });
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, '❌ Error fetching token PnL.');
    }
  });
  bot.onText(/\/scan (.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const query = match[1].trim();
  
    sendTokenInfoByAddress(query, chatId, bot)
      
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;
  
    // Cherche un mot qui commence par $ et capture ce qui suit
    const match = text.match(/\$([a-zA-Z0-9_]+)/);
    if (match) {
      const ticker = match[1]; // le texte après $
      await sendTokenInfoByAddress(ticker, chatId, bot);
    }
  });


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
  
    const possibleAddress = text.match(/[a-zA-Z0-9]{25,}/g);
    const now = Date.now();
  
    if (possibleAddress && possibleAddress.length > 0) {

    
        const chatId = msg.chat.id.toString();
        const query =  possibleAddress[0];
      
       
        sendTokenInfoByAddress(query, chatId, bot)
        
   
      
    }
  });