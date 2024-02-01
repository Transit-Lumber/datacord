// Login to minutesBot and dataBot with discord.js
// Require discord.js
const { Client, GatewayIntentBits } = require('discord.js')

// Create the new client instance including the intents needed for the bot (like presence and guild messages)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
})

// Log in to Discord with your client's token
client.login(process.env.CLARKE_DISCORD_TOKEN)

let state = {
  config: await loadConfig()
}

let keys = {
  apca: {
    "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID,
    "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY,
  },
  twlv: process.env.TWLV_API_KEY
}

client.on('ready', async (bot) => {
  // Run the main bot loop every 30 seconds, starting 1 second after the nearest 'snap' point
  state.bot = bot
  let waitMs = 30000 - new Date().getTime() % 30000

  setTimeout(() => { setInterval(autoTrader, 30000) }, waitMs + 10000)
})

async function autoTrader() {
  // Update status to have current portfolio stats
  state.now = new Date()

  // Check if market opening / closing times need to be fetched
  if (!state.timestamp || (state.now > state.next_open && state.now > state.next_close)) {
    // Fetch and update
    let data = await fetchTimes()

    state = {
      ...state,
      ...data,
      next_open: new Date(data.next_open),
      next_close: new Date(date.next_close)
    }

  }
  // Check if now opening / closing
  else if (state.is_open ? state.now > state.next_close : state.now > state.next_open) {
    state.is_open = !state.is_open
    await sendReport()
  }

  // If open...
  if (state.is_open) {

    // Check stocks if on a 5-minute rotation
    if (!(state.now.getMinutes() % 5) && state.now.getSeconds() < 10) {
      await stockCheck()
    }

  }
}

async function fetchTimes() {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...keys.apca
    }
  };

  return await fetch('https://paper-api.alpaca.markets/v2/clock', options)
    .then(response => response.json())
    .catch(err => console.error(err));
}

async function stockCheck() {
  // Get the current typical stock price
  let price = parseFloat(await fetchPrice())

  // If there is no midpoint then set that to the current price and return
  if (state.config.midpoint == null) {
    state.config.midpoint = price
    saveConfig()
    return
  }

  // Use margin config to calculate heading bounds
  let lowerBound = Math.min(state.config.midpoint - state.config.marginDiff, state.config.midpoint * (1 - state.config.marginPerc))
  let upperBound = Math.max(state.config.midpoint + state.config.marginDiff, state.config.midpoint * (1 + state.config.marginPerc))

  switch (state.config.heading) {
    // If heading is 1...
    case 1:
      // Increase - Update midpoint
      if (price >= midpoint) {
        state.config.midpoint = price
        saveConfig()
      }
      // Decrease by X - Update midpoint, change heading to 0
      else if (price < lowerBound) {
        state.config.midpoint = price
        state.config.heading = 0
        saveConfig()
      }

      break;

    // If heading is -1...
    case -1:
      // Decrease - Update midpoint
      if (price <= midpoint) {
        state.config.midpoint = price
        saveConfig()
      }
      // Increase by X - Update midpoint, change heading to 0
      else if (price > upperBound) {
        state.config.midpoint = price
        state.config.heading = 0
        saveConfig()
      }
      break;

    // If heading is 0 / undefined / null / other...
    default:
      // Increase by X - update midpoint, change heading to 1, buy stock
      if (price > upperBound) {
        order("buy", price)
      }
      // Decrease by X - update midpoint, change heading to -1, sell stock
      else if (price < lowerBound) {
        order("sell", price)
      }
      break;
  }
}

async function order(side, price) {
  // Get the current position (if any)
  let position = await fetchPositions()
  let account = await fetchAccount()

  let bodyObj = {
    symbol: "TSLA",
    side,
    type: "market",
    time_in_force: "fok",
    client_order_id: new Date().toISOString()
  }

  // Try to execute the order, only changing the midpoint and heading if successful
  switch (side) {
    // Buying
    case 'buy':
      // Can't if already has stock
      if (position.qty) return;

      // Try to buy some stock
      bodyObj.qty = (parseFloat(account.cash) * state.config.buyPerc / price).toString()

      break;

    // Selling
    case 'sell':
      // Can't if doesn't have stock
      if (!position.qty) return;

      // Try to sell all of that stock
      bodyObj.qty = position.qty

      break;
  }

  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      ...keys.apca
    },
    body: JSON.stringify(bodyObj)
  };

  fetch('https://paper-api.alpaca.markets/v2/orders', options)
    .then(response => {
      sendMessage(`New Order Created:\n\n    TYPE: \`${side}\`\n    QTY: \`${bodyObj.qty}\`\n    ESTIMATED VALUE: \`${parseFloat(bodyObj.qty) * price}\`\n    STATUS: \`${response.status}\``)
    })
    .catch(err => console.error(err));
}

async function fetchAccount() {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...keys.apca
    }
  };

  return await fetch('https://paper-api.alpaca.markets/v2/account', options)
    .then(response => response.json())
    .catch(err => console.error(err));
}

async function fetchPositions() {
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...keys.apca
    }
  };

  return await fetch('https://paper-api.alpaca.markets/v2/positions/TSLA', options)
    .then(response => response.json())
    .catch(err => console.error(err));
}

function sendMessage(msg) {
  state.bot.channels
    .fetch('1199976538930688040')
    .then(async (channel) => {
      channel.send(msg)
    })
}

async function fetchPrice() {
  return await fetch(`https://api.twelvedata.com/typprice?apikey=ed5846d2aa5b43deaaa92f4872d056c3&interval=1min&timezone=Pacific/Auckland&format=JSON&symbol=TSLA&outputsize=1`)
    .then(async response => {
      let data = await response.json()

      if (data.status == 'ok') return data.values[0].typprice
      return
    })
    .catch(err => console.error(err));
}

async function loadConfig() {
  let field = 'clarke'

  // Get the data from local.json or firebase (then save it to local.json)
  var fetchedData = JSON.parse(fs.readFileSync('local.json', 'utf8'))
  if (fetchedData[field] == null) {
    const docRef = firebase.collection(firebase.datacord, 'data')
    const docSnap = await firebase.getDocs(docRef)
    const doc = docSnap.docs.find((doc) => doc.id == field)
    const final = JSON.parse(doc.data().data)
    fetchedData[field] = final
    fs.writeFileSync('local.json', JSON.stringify(fetchedData))
    return final
  } else {
    return fetchedData[field]
  }
}

function saveConfig() {
  let field = 'clarke'
  let data = state.config

  // Update the data in local.json and firebase
  const docRef = firebase.collection(firebase.datacord, 'data')
  const docSnap = firebase.doc(docRef, field)
  firebase.setDoc(docSnap, { data: JSON.stringify(data) })
  var fetchedData = JSON.parse(fs.readFileSync('local.json', 'utf8'))
  fetchedData[field] = data
  fs.writeFileSync('local.json', JSON.stringify(fetchedData))
}