'use strict';

const Homey       = require('homey');
const Helper      = require('../../lib/helper');


/**
 * @todo consistent naming of grouped vs devices
 * In scope of this application the 'device' is the virtual item.
 * Where as the grouped are the devices that we are working with.
 * However it looks like the original intention was for this device
 * to be called 'GroupDevice'. Whether or not it semantically correct
 * more critical at the moment is its inconsistent use. eg.
 * deviceGroup = this.settings.groupedDevices :: but class = DeviceGroup
 */
class DeviceGroupDevice extends Homey.Device {

  /**
   * Automatically runs
   * Gathers the required properties, sets our listeners, and polls
   */
  async onInit() {
    this.log('Initialising ' + this.getName());

    // Set our properties
    this.settings = await this.getSettings();
    this.capabilities = this.getCapabilities();
    this.interval = false;
    this.devices = {};

    try {
      await this.checkForUpdates();
      this.initListener();            // don't wait
      this.initPolls();               // don't wait
      this.updateDevicesLabels();
      this.updateCapabilityLabels();
    } catch (error) {
      this.error(error);
    }
  }


  /**
   * Refresh the settings & capability listeners
   *
   * Sets device unavailable/available while updating, there is a race condition which is being causes (generally)
   * by the settings page, where multiple refreshes will be running at once, this plays havoc on the device. (eg. destroying polls)
   * There is an attempt with in the view to reduce the chances of this by waiting
   * for a API response however this seems to have issues when unexpected event occur, or even immediate clicks after the call back has returned.
   *
   * @todo I believe the end solution is to change the settings to a button click -> set disabled, callback to re-enable.
   * TAs the i
   * @returns {Promise<boolean>}
   */
  async refresh() {
    this.log('Refreshing Device Group ' + this.getName());

    try {
      await this.setUnavailable();              // Set card to unavailable
      this.settings = await this.getSettings(); // update the settings, ensure this happens prior to updating polls/labels
      this.devices = {};                        // Empty our device cache
      this.updateDevicesLabels();               // update the device label (settings which store current devices)
      this.updateCapabilityLabels();            // update the capability labels (settings which store current capability/methods)
      this.destroyPoll();                       // destroy the polling
      this.initPolls();                         // re-initialise the polling
      await this.setAvailable();                // set the card back to being available
    } catch (error) {
      this.console.log(error);
      this.error(error);
    }

    return true;
  }


  /**
   * Initialises the capability listener.
   *
   * Basically : Registers every capability this device (MultipleCapabilityListener) has, so
   * when any of the devices capabilities are changed, the function is called  which sets the
   * value of all of the 'grouped/real' devices to said value.
   *
   * @returns {Promise<void>}
   */
  async initListener() {
    this.log('Initialising Listener Device Group ' + this.getName());
    // Register all of the capabilities at once with a (async) call back.
    return this.registerMultipleCapabilityListener(this.capabilities, async (valueObj, optsObj) => {
      return this.updateCapability(valueObj, optsObj);
    }, 500);
  }


  /**
   * Update the value of all the grouped items
   *
   * Note that it's using the API to set the values.
   *
   * @param valueObj
   * @param optsObj
   * @returns {Promise<*>}
   */
  async updateCapability(valueObj, optsObj) {
    this.log('Update Capability Device Group ' + this.getName());
    // Loop through each 'real' device in the group
    for (let key in this.settings.groupedDevices) {

      // Get the WebAPI reference 'real' device ::
      let device = await this.getDevice(this.settings.groupedDevices[key]);

      // Using the API for the 'real' device, set the capability value, to what ever we just changed.
      for (let capabilityId in valueObj) {
        device.setCapabilityValue(capabilityId, valueObj[capabilityId]).catch((error) => {
          this.log('Error setting capability ' + capabilityId + ' on ' + this.getName() + ' err' + error.message);
        });
      }
    }

    return true;
  }


  /**
   * Initialise the polling,
   *
   * Will then assign the pollDevice to be ran on pollingFrequency. this is how we gather our grouped devices data
   * to ensure that the card/mobile is kept up to date. Will run the first poll ensuring the device is up to date from the start.
   *
   * @todo Initally I attempted to add a deviceCapability listener to the individual devices, but was unsuccessful.
   * @returns {Promise<boolean>}
   */
  async initPolls() {
    this.log('Initialising Polls Device Group ' + this.getName());
    // Run our initial poll immediately.
    await this.pollDevices();

    // Another hack to compensate for the Ajax settings.
    if (this.interval === false) {
      // Set the polling interval based from the settings, once we have the first value.
      this.interval = setInterval(async () => {
        this.pollDevices();
      }, 1000 * this.settings.pollingFrequency); // In seconds
    }

    return true;
  }


  /**
   * Simple function to do a poll
   *
   * Gets the devices values, and then sets the grouped card values.
   * @returns {Promise<void>}
   */
  async pollDevices() {
    this.setCardValues(
        await this.getDevicesValues()
    );
  }


  /**
   * Get all of the grouped capability values for all of the devices
   *
   * @returns {Promise<void>}
   */
  async getDevicesValues() {
    let values = [];

    // Initialise the values
    for (let i in this.capabilities) {
      values[this.capabilities[i]] = [];
    }

    // Loop through each of the devices in the group
    for (let x in this.settings.groupedDevices) {

      // There is a bug where this is called while group devices is empty ..
      // Seems to be prevalent when updating the settings using the API, possibly race condition
      if (this.settings.groupedDevices.hasOwnProperty(x)) {

        // requires the API. @todo investigate whether this should be stored in memory
        let device = await this.getDevice(this.settings.groupedDevices[x])

        // A refresh is required for the API when accessing capabilities.
        await device.refreshCapabilities();

        // Loop through each of the capabilities checking each of the devices value.
        for (let i in this.capabilities) {
          values[this.capabilities[i]].push(device.state[this.capabilities[i]]);
        }
      }

    }
    return values;
  }


  /**
   * Assigns a card's values to the values of the supplied devices
   *
   * Based off of the capabilities and their values supplied and which methods they have assigned to them
   * setCardValues will determine what value each of the capabilities of this device should be then assigns it
   *
   * @param values
   * @returns {Promise<void>}
   */
  async setCardValues(values) {

    // loop through each of the capabilities calculating the values.
    for (let i in this.capabilities) {

      // Aliases
      let key = this.capabilities[i];                         // Alias the capability key
      let value = values[key];                                // Alias the value
      let method = this.settings.capabilities[key].method;    // Alias the method we are going to use
      let type = Homey.app.library.getCapability(key).type;        // Alias the data type

      // if the method is false - its disabled if it's set to ignore, don't update use the card behaviour.
      if (method !== false && method !== 'ignore') {

        // Calculate our value using our function
        value = Helper[Homey.app.library.getMethod(method).function](value);

        // Convert the value in the to capabilities required type
        value = Helper[type](value);

        try {
          // // Set the capability of the groupedDevice
          this.setCapabilityValue(key, value);
        } catch (error) {
          this.log('Error on setting capability value : ' + key + ' ' + value + ' err:' +  error.message); // DEBUG
          throw new error;
        }

      }
    }
  }


  /**
   * Will update the devices label setting to the current devices.
   *
   * @returns {Promise<void>}
   */
  async updateDevicesLabels() {
    this.log('Update Device Labels Device Group ' + this.getName());
    let labels = [];

    for (let key in this.settings.groupedDevices) {

      let device = await this.getDevice(this.settings.groupedDevices[key]);

      labels.push(device.name);
    }

    this.setSettings({labelDevices : labels.join(', ')});
  }

  /**
   * Will update the capabilities label setting
   *
   * @returns {Promise<void>}
   */
  async updateCapabilityLabels() {
    this.log('Update Capability Labels Device Group ' + this.getName());
    let labels = [];
    for (let i in this.capabilities) {

      // Alias
      let capability = Homey.app.library.getCapability(this.capabilities[i]);
      let method = this.settings.capabilities[this.capabilities[i]].method

      labels.push(capability.title['en']);

      // If we have a method assigned, attach it to our description.
      if (method) {
        labels[labels.length -1] += ' (' + Homey.app.library.getMethod(method).title[Homey.App.i18n] + ')';
      }
    }

    this.setSettings({labelCapabilities : labels.join(', ')});
  }


  /**
   * Check for application updates, and then update if required
   * @todo get beta ready
   * @returns {Promise<*>} true if update installed, false if no update
   */
  async checkForUpdates() {
    return false;
    try {

      // If we do not have a version property at all
      // This device was added prior to 1.2.0 when the version was instated.
      // Upgrade the item with all 1.2.0 features disabled.
      if (!this.store.hasOwnProperty('version')) {

        console.log('Upgrading ' + this.getName());

        let capabilities = await this.getCapabilities();
        let settings = {capabilities : {}};

        for (let i in capabilities) {

          // Add all the settings which are new to 1.2.0
          // Default each of method to false (ie disabled).
          settings.capabilities[capabilities[i]] = {};
          settings.capabilities[capabilities[i]].method = false;
        }

        // Gigo check :: that there are capabilities
        if (Object.keys(settings.capabilities).length) {

          this.setSettings(settings);
          this.setStoreValue('version', '1.2.0');
          this.store.version = '1.2.0';

          console.log('Completed ' + this.getName() + ' ' + this.store.version + ' upgrade');
          return true;
        }
      }
    }
    catch (error) {
      //@todo exception handing
      throw new error;
    }
    return false;
  }

  /**
   * Gets an API device from the APP, caches it
   *
   * Was added as storing the entire device on each driver seemed to use less memory
   * than making the API call.
   *
   * @param id
   * @returns {Promise<*>}
   */
  async getDevice(id) {

    if (!this.devices[id]) {
      // Get the WebAPI reference 'real' device
      this.devices[id] = await (await Homey.app.api).devices.getDevice({
        id : id
      });
    }
    return this.devices[id];
  }


  /**
   * Remove the poll when device deleted
   */
  onDeleted() {
    this.log('Deleting  Device Group ' + this.getName());
    this.destroyPoll();
  }


  /**
   * Removing device interval polling
   */
  destroyPoll() {
    this.log('Destroying Poll Device Group ' + this.getName());
    clearInterval(this.interval);
    this.interval = false;
  }
}

module.exports = DeviceGroupDevice;

