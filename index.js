/**
 * JavaScript example showing proper use of the Cisco Sample Code header.
 * @author Bob Garland <bogarlan@cisco.com>
 * @copyright Copyright (c) 2018 Cisco and/or its affiliates.
 * @license Cisco Sample Code License, Version 1.0
 */

/**
 * @license
 * Copyright (c) 2018 Cisco and/or its affiliates.
 *
 * This software is licensed to you under the terms of the Cisco Sample
 * Code License, Version 1.0 (the "License"). You may obtain a copy of the
 * License at
 *
 *                https://developer.cisco.com/docs/licenses
 *
 * All use of the material herein must be in accordance with the terms of
 * the License. All rights not expressly granted by the License are
 * reserved. Unless required by applicable law or agreed to separately in
 * writing, software distributed under the License is distributed on an "AS
 * IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied.
 */

/**
 *************************************************************************************************
 *
 * index.js exports all the Cloud Functions required for the application:
 * (1) ingestCMX - takes the Meraki scanning API POSTs and publishes them to a pub/seb topic - scanning-api-post
 * (2) writeCMXentity - subscribes to scanning-api-post topic and dumps JSON data into Cloud Datastore
 * (3) writeCMXDataToWebexTeams - subscribes to the scanning-api-post topic. Formats CMX data in human readable format and posts to a WT Space
 * (4) customerDetect - subscribes to the scanning-api-post topic. Does a MAC address lookup on a fake "CRM". Publishes to customer-detect topic.
 * (5) customerAction - subscribes to the customer-detect topic and does <some action> based on CRM data
 * (6) initCRM - intended to be run once via HTTP trigger to store some initial customer entities into Datastore "CRM"
 *
 * NOTES:
 *  - MAC address are stored and displayed raw. This is demo code only.
 *  - This has only been tested on a single AP Meraki network. Multiple APs may break it or take you over the GCP Free Tier for compute or storage.
 *
 * TO DO:
 *  - Hash MAC addresses on ingest and in "CRM" for privacy
 *  - Test on networks with multiple Access Points
 *  - Collect location (x,y) / (lat,long) data and do something interesting with it
 *  - Bluetooth data is stored but ignored. Why bother? Also, don't publish message to scanning-api-post topic to reduce Function execution time
 *  - Implement more useful customer actions - e.g. send a SMS (Tropo) or Staff App notification
 *
 */

// Constant definitions - MODIFY TO FIT YOUR DEPLOYMENT
//
// Name of your GCP Project here
const projectId = "serverless-cmx";
//
// The validator string to pass back to Meraki to confirm URI POST (from Meraki dashboard)
const validator = "ABCDEF856e34a80e8887e0d5d0206dcfeff165e0";
//
// The secret that Meraki must pass to the POST URI (cmxIngest Cloud Function HTTP trigger) for verification
const secret = "gcp-meraki-secret";
//
// The "Meraki Bot" Webex Teams token for access
// The Bot posts Meraki data (nicely formated API data) and Customer Actions (staff notificiations about customers)
const merakiCmxBotToken = 'ABCDEFG4NzEtMDQ3Yi00ZTM5LTk5NGUtNTRlZDE3ZTYxODI4NTRmZDAyNDAtNDcy';
//
// Webex Teams Rood IDs can be discovered via https://developer.webex.com/endpoint-rooms-get.html
// Webex Teams Room ID to write human-readable CMX data to.
const cmxDataRoomID = 'ABCDEF9zcGFyazovL3VzL1JPT00vMmExMTJkODAtOTc5Yy0xMWU2LThkNGEtOWI5ODc0ZjljNWE0';
// Webex Teams Room ID to write customer notifications to. Bot must me a member of both rooms
const customerActionRoomID = 'ABCDEF9zcGFyazovL3VzL1JPT00vMTc0YjllMTAtNTkxZi0xMWU4LTg0ZTMtNzNjZTcwNmRmYjQ1';


// Other constant definitions
//
// Import the Google Cloud client node.js packages for Pub/Sub and Datastore
const PubSub = require(`@google-cloud/pubsub`);
const Datastore = require('@google-cloud/datastore');
// Create pub/sub instances for both topics
const cmxpubsub = new PubSub();
const custpubsub = new PubSub();
// Some custom attributes used to identify the application publishing a message to a PubSub topic
const customAttributes = {
  origin: 'serverless-cmx',
  username: 'FredBloggs',
};
// Pub/Sub Topic to publish CMX data to
const scanningTopicName = 'projects/' + projectId + '/topics/scanning-api-post';
// Pub/Sub Topic to publish Customer CRM data to
const customerTopicName = 'projects/' + projectId + '/topics/customer-detected';

// Instantiate a Datastore instance
const datastore = Datastore({
  projectId: projectId
});
// Use the Webex Teams JavaScript SDK
// May 2018 - Cisco Spark is undergoing rebranding to Webex Teams. This package may change name.
const webexteams = require(`ciscospark`);
const wt = webexteams.init({
  credentials: {
    access_token: merakiCmxBotToken
  }
});
// NPS definitions
const nps=["Detractor","Passive","Promotor"];


/**
 * (1) ingestCMX - takes the Meraki scanning API POSTs and publishes them to a pub/seb topic - scanning-api-post
 *
 * handleGET - responds to a GET request with the Meraki validator string.
 * handlePOST - responds to a POST by logging body to console
 *
 */

function handleGET (req, res) {
  // Process the GET request from Meraki. Executes once only on POST URL validation
  // Send the Meraki validator string to confirm
  console.log('Validator string sent back to Meraki = ' + validator);
  res.status(200).send(validator);
}


// Responds to a POST by publishing the JSON data to the scanning-api-post topic
function handlePOST (req, res) {
  // Process the POST request from Meraki with the CMX data payload
  if (req.body.secret == secret) {
    // If Meraki POST has sent the correct secret then proceed
    var cmxDataBuffer = Buffer.from(JSON.stringify(req.body));
    console.log('Correct secret sent = ' + req.body.secret);
    console.log(req.body);

    // Publish the incoming CMX data from the Meraki API POST to the Pub/Sub topic
    cmxpubsub
      .topic(scanningTopicName)
      .publisher()
      .publish(cmxDataBuffer, customAttributes)
      .then(results => {
      const messageId = results[0];
      console.log(`Message ${messageId} published.`);
    })
      .catch(err => {
      console.error('ERROR:', err);
    });

    // Send back everything OK
    res.status(200).end();
  } else {
    // Wrong secret - ERROR
    console.log("Wrong secret")
    res.status(500).send({ error: 'Wrong secret'});
  }
}

exports.ingestCMX = (req, res) => {

  switch (req.method) {
    case 'GET':
      handleGET(req, res);
      break;
    case 'POST':
      handlePOST(req, res);
      break;
    default:
      res.status(500).send({ error: 'Something blew up!' });
      break;
  }
};


/**
 *************************************************************************************************
 *
 * (2) writeCMXentity - subscribes to scanning-api-post topic and dumps JSON data into Cloud Datastore
 * Google Cloud Datastore is a NoSQL database which is simple and has a free tier
 * Good overview here https://cloud.google.com/datastore/docs/concepts/overview
 * Two kinds of data are stored - bluetooth-observations and wlan-observations
 * With a single Meraki AP, the location data (x,y) has no value and is discarded
 *
 */

// Function to add an observation to Cloud Datastore of kind=type
// where type = wlan-observation or bluetooth-observation
function addObservation(obs, apMac, type) {
  // Key is set to simply use the <kind> without using a key name so that Datastore automatically assigns a random ID
  // The full key (including the automatically assigned ID) of the entity will be returned when an entity with
  // the incomplete key is saved to Cloud Datastore.
  const observationKey = datastore.key(type);
  const entity = {
    key: observationKey,
    data: [
      {
        name: 'seenTime',
        value: obs.seenTime.toString(),
      },
      {
        name: 'seenEpoch',
        value: obs.seenEpoch.toString(),
      },
      {
        name: 'MAC',
        value: obs.clientMac.toString(),
      },
      {
        name: 'apMAC',
        value: apMac,
      },
      {
        name: 'Associated',
        value: (obs.ssid == null) ? "N" : "Y",
      },
      {
        name: 'SSID',
        value: (obs.ssid==null) ? "null" : obs.ssid.toString(),
      },
      {
        name: 'IPv4',
        value: (obs.ipv4==null) ? "null" : obs.ipv4.toString(),
      },
      {
        name: 'IPv6',
        value: (obs.ipv6==null) ? "null" : obs.ipv6.toString(),
      },
       {
        name: 'Manufacturer',
        value: (obs.manufacturer==null) ? "null" : obs.manufacturer.toString(),
      },
       {
        name: 'RSSI',
        value: (obs.rssi==null) ? "null" : obs.rssi.toString(),
      },
       {
        name: 'OS',
        value: (obs.os==null) ? "null" : obs.os.toString(),
      }
    ],
  };

  datastore
    .save(entity)
    .then(() => {
      console.log(`Observation ${observationKey.id} created successfully.`);
    })
    .catch(err => {
      console.error('ERROR:', err);
    });
}

// The Cloud Function itself
exports.writeCMXentity = (event, callback) => {
  // The Cloud Pub/Sub Message object
  const pubsubMessage = event.data;

  // This seems like a clunky way to get at the JSON data in the message by converting to a String and then parsing...
  const msg_text = Buffer.from(pubsubMessage.data, 'base64').toString();
  const msg_json = JSON.parse(msg_text);
  // Which Meraki API version are we dealing with. Should be 2.0
  const vers = msg_json.version;
  // Log useful debug messages to console
  console.log(`API Version = ${vers}`);
  console.log(`Full pub/sub message data payload = ${msg_text}`);

  // type - Wi-Fi or Bluetooth?
  const type = msg_json.type;
  // apMac - which AP observed this?
  const apMac = msg_json.data.apMac;
  // List of client observations in JSON format - MAC addresses, location, OS, manufacturer, etc...
  const observations = msg_json.data.observations;

  // Build different client reports for Wi-Fi and Bluetooth
  if (type=="DevicesSeen") {
    console.log("Wi-Fi Report");

    // Iterate across all clients reported in the observations array detailing the clients and AP that observed them
    observations.forEach(function(entry) {
      addObservation(entry, apMac, "wlan-observation");
    });
  } else if (type=="BluetoothDevicesSeen") {
    console.log("Bluetooth Report");

    // Iterate across all clients reported in the observations array detailing the clients and AP that observed them
    observations.forEach(function(entry) {
      addObservation(entry, apMac, "bluetooth-observation");
    });

  } else {
    // Error message to console if type is unknown
    console.log('Unknown type of Meraki POST');
  }

  // Don't forget to call the callback.
  callback();
};


/**
 * (3) writeCMXDataToWebexTeams - subscribes to the scanning-api-post topic.
 * Formats CMX data in human readable format and posts via a Bot into a Webex Teams Room (cmxDataRoomID)
 * Uses the Cisco Webex Teams JavaScript SDK
 *
 */

exports.writeCMXDataToWebexTeams = (event, callback) => {
  // The Cloud Pub/Sub Message object received from the Pub/Sub function trigger
  const pubsubMessage = event.data;

  // This seems like a clunky way to get at the JSON data in the message by converting to a String and then parsing...
  const msg_text = Buffer.from(pubsubMessage.data, 'base64').toString();
  const msg_json = JSON.parse(msg_text);
  // Which Meraki API version are we dealing with. Should be 2.0
  const vers = msg_json.version;
  // Log vaguely useful debug messages to console
  console.log(`API Version = ${vers}`);
  console.log(`Full pub/sub message data payload = ${msg_text}`);

  // type - Wi-Fi or Bluetooth?
  const type = msg_json.type;
  // apMac - which AP observed this?
  const apMac = msg_json.data.apMac;
  // List of client observations in JSON format - MAC addresses, location, OS, manufacturer, etc...
  const observations = msg_json.data.observations;

  // Build up a single markdown message string to avoid async, out of order Webex Teams message posts
  // I'll get the hang of javascript promises later...
  // Start off on a new line for the Webex Teams message
  var clients = '\n';

  // Build different client reports for Wi-Fi and Bluetooth
  if (type=="DevicesSeen") {
    console.log("Wi-Fi Report");

    clients=clients+`**Incoming Wi-Fi observations from Meraki AP (${apMac}):**\n`+ "```\n";

    // Build up clients report from observation array
    observations.forEach(function(entry) {
      // Basic info MAC address and when seen
      clients=clients + 'Client MAC ' + entry.clientMac.toString() + ' seen at ' + entry.seenTime.toString();
      // Append additional information if present
      if (entry.ssid == null) { clients=clients + ' | Unassociated' } else { clients=clients + ' | SSID : ' + entry.ssid.toString(); }
      if (entry.ipv4 == null) { clients=clients + ' | No IP Address' } else { clients=clients + ' | IPv4 ' + entry.ipv4.toString(); }
      if (entry.rssi != null) { clients=clients + ' | RSSI = ' + entry.rssi.toString(); }
      if (entry.os != null)   { clients=clients + ' | OS = ' + entry.os.toString(); }
      if (entry.manufacturer != null) { clients=clients + ' | Manufacturer = ' + entry.manufacturer.toString(); }
      clients=clients+`\n`;
    });
  } else if (type=="BluetoothDevicesSeen") {
    console.log("Bluetooth Report");

    clients=clients+`**Incoming Bluetooth observations from Meraki AP (${apMac}):**\n`+ "```\n";

    // Build up client report from observation array
    observations.forEach(function(entry) {
      // Basic info  - MAC address and when seen
      clients=clients + 'Client MAC ' + entry.clientMac.toString() + ' seen at ' + entry.seenTime.toString();
      // Append additional information if present
      if (entry.rssi != null) { clients=clients + ' | RSSI = ' + entry.rssi.toString(); }
      if (entry.os != null) { clients=clients + ' | OS = ' + entry.os.toString(); }
      if (entry.manufacturer != null) { clients=clients + ' | Manufacturer = ' + entry.manufacturer.toString(); }
      clients=clients+`\n`;
    });
  } else {
    // Error message if type is unknown
    clients=clients+`**Data of unknown origin has arrived....**\n`+ "``` null\n";
  }

  clients=clients+"```\n";

  // Write out list of client observations to Webex Teams in markdown
  wt.messages.create({
        markdown: clients,
        roomId: cmxDataRoomID
    });

  // Don't forget to call the callback.
  callback();
};


/**
 * (4) customerDetect - subscribes to the scanning-api-post topic. Does a MAC address lookup on a fake "CRM".
 * Publishes customer "CRM" entity to the customer-detect topic.
 * Other functions can subscribe to this to take actions based on CRM data.
 *
 */

// Tnis is the function that Cloud Functions will call
exports.customerDetect = (event, callback) => {
  // The Cloud Pub/Sub Message object
  const pubsubMessage = event.data;

  // This seems like a clunky way to get at the JSON data in the message by converting to a String and then parsing...
  const msg_text = Buffer.from(pubsubMessage.data, 'base64').toString();
  const msg_json = JSON.parse(msg_text);

  // type - Wi-Fi or Bluetooth?
  const type = msg_json.type;
  // apMac - which AP observed this?
  const apMac = msg_json.data.apMac;

  // List of client observations in JSON format - MAC addresses, location, OS, manufacturer, etc...
  const observations = msg_json.data.observations;

  // We are only interested in Wi-Fi (ignore Bluetooth)
  if (type=="DevicesSeen") {
    // Log useful debug messages to console like a list of MAC addresses that need checking to see if we have a customer-record
    var mac_list = '';
    observations.forEach(obs => mac_list = mac_list + obs.clientMac + ', ');
    console.log(`Observed Wi-Fi MAC addresses to lookup in customer-records = ${mac_list}`);

    // Iterate across all clients reported in the observations array and do a "CRM" lookup
    observations.forEach(function(obs) {
      // Lookup the MAC address of the observation to determine if it is a known customer
      // If so, then update the customer-record entity with the WHEN (epoch) and WHERE (observing AP)
      const query = datastore
      .createQuery('customer-record')
      .filter('macAddress', '=', obs.clientMac);

      // Run query
      datastore.runQuery(query).then(results => {
        // Matching customer entities found
        // There should only be one...
        var customer = results[0][0];

        if (customer !== undefined) {
          // We got a hit on the MAC address in the customer-records datastore!
          // Log some info about it
          console.log('Customer = ' + customer.surname + ' email = ' + customer.email + ' spotted by ' + apMac + ' lastSeen = ' + customer.lastSeen);
          // Update WHEN - the time that this customer's mobile device was seen in the store / venue
          customer.lastSeen = obs.seenEpoch;
          // Update WHERE - the observing AP which can be linked to a specific store / venue or zone
          customer.observingAp = apMac
          // Write the updated entity to the Cloud Datastore
          datastore.update(customer).then(() => {
            // Log that the customer record has been updated
            console.log('updated CRM customer-record');
          });

          // Customer entity retreived from Datastore the Datastore query to be published to customer-detect topic
          const custDataBuffer = Buffer.from(JSON.stringify(customer));

          // Publish the customer entity to the Pub/Sub topic
          custpubsub
            .topic(customerTopicName)
            .publisher()
            .publish(custDataBuffer, customAttributes)
            .then(results => {
            const messageId = results[0];
            console.log(`Message ${messageId} published.`);
          })
            .catch(err => {
            console.error('PUB/SUB ERROR:', err);
          });
        }
      }).catch(error => console.log(error));
    });
  } else if (type=="BluetoothDevicesSeen") {
    console.log("Bluetooth observations - not worth getting out of bed for....");
    // Do nothing

  } else {
    // Error message to console if type is unknown
    console.log('Unknown type of Meraki POST');
  }

  // Don't forget to call the callback.
  callback();
};


/**
 * (5) customerAction - subscribes to the customer-detect topic and does <some action> based on CRM data
 * The sample <some action> taken is to post to a Webex Teams Room. Yawn. How about an SMS instead
 * This is just a demo - this function doesn't have any consideration of time. It's like a goldfish.
 *
 */

// Tnis is the function that Cloud Functions will call
exports.customerAction = (event, callback) => {
 // The Cloud Pub/Sub Message object.
 const pubsubMessage = event.data;
 const customer_text = Buffer.from(pubsubMessage.data, 'base64').toString();
 const customer = JSON.parse(customer_text);

 // We're just going to log the message to show that it triggered
 console.log('*** customer-detected ***');
 console.log(Buffer.from(pubsubMessage.data, 'base64').toString());

 // Build up a single markdown message string to avoid async, out of order Webex Teams message posts
 // I'll get the hang of javascript promises later...
 var wtMessage = `\n  >**Customer in-store:** ${customer.firstName} ${customer.surname}, phone number: ${customer.mobilePhoneNumber}, email: ${customer.email}\n`;

 console.log(`customer.loyaltySchemeMember = ${customer.loyaltySchemeMember}`);
 console.log(`customer.clickAndCollect = ${customer.clickAndCollect}`);

 if (customer.loyaltySchemeMember == "Y") {
   const npsType=nps[Math.floor((Math.random() * 3))];
   wtMessage=wtMessage+`\n\n  **Loyalty Scheme Member** ${customer.firstName} ${customer.surname}. Points = 578, Annual Spend = £156, Net Promotor = ${npsType}\n`;
 }

 if (customer.clickAndCollect == "Y") {
   const order=Math.floor((Math.random() * 1000000000) + 100000000);
   wtMessage=wtMessage+`\n\n  **Click & Collect Customer** ${customer.firstName} ${customer.surname} has an online order ready for collection ref: OL${order}\n`;
 }

  // Write out message about the customer to Webex Teams in markdown
  wt.messages.create({
        markdown: wtMessage,
        roomId: customerActionRoomID
    });

 // Don't forget to call the callback.
 callback();
};



/**
 * (6) initCRM - intended to be run once via HTTP trigger to store some initial customer entities into datastore
 * Special run-once and delete Function to populate "CRM" with sample data
 *
 */

// Tnis is the function that Cloud Functions will call
exports.initCRM = (req, res) => {

  const customerList = [
    {
      firstName: 'Fred',
      surname: 'Flintstone',
      email: 'fred.flintstone@gmail.com',
      macAddress: '20:df:b9:c7:19:f9',
      mobilePhoneNumber: '07815453982',
      loyaltySchemeMember: 'N',
      clickAndCollect: 'N'
    },
    {
      firstName: 'Barney',
      surname: 'Rubble',
      email: 'barney@slate-rock.com',
      macAddress: '60:f6:77:05:f0:9b',
      mobilePhoneNumber: '07978342654',
      loyaltySchemeMember: 'Y',
      clickAndCollect: 'N'
    },
    {
      firstName: 'Wilma',
      surname: 'Flintstone',
      email: 'wilma@yahoo.com',
      macAddress: 'ec:9b:f3:69:f7:22',
      mobilePhoneNumber: '07917073876',
      loyaltySchemeMember: 'Y',
      clickAndCollect: 'Y'
    },
    {
      firstName: 'Stoney',
      surname: 'Curtis',
      email: 'curtis@hollywood.com',
      macAddress: '40:4e:36:8b:d0:2a',
      mobilePhoneNumber: '07925073524',
      loyaltySchemeMember: 'N',
      clickAndCollect: 'Y'
    },
    {
      firstName: 'Pearl',
      surname: 'Slaghoople',
      email: 'pearly@geocities.com',
      macAddress: '78:4f:43:a0:df:f2',
      mobilePhoneNumber: '07775073936',
      loyaltySchemeMember: 'N',
      clickAndCollect: 'Y'
    }];

  // Set the Datastore 'kind' to be customer-record
  const customerKey = datastore.key('customer-record');

  // Insert each customer in the customerList into Cloud Datastore
  customerList.forEach(function(cust) {
    const entity = {
        key: customerKey,
        data: cust
    };

    datastore.insert(entity).then(() => {
      // Customer record inserted successfully.
      console.log(cust.firstName + ' ' + cust.surname + " inserted into customer-record CRM")
    });
  });
  res.send('Customer CRM database initialised with some sample data');
};
