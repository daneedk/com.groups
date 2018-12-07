'use strict';

const Homey = require('homey');
// const { HomeyAPI } = require('athom-api');
const HomeyAPI = require('athom-api');
const Librarian   = require('./lib/librarian');



async function login() {

  //Authenticate against the current Homey.
  const homeyAPI = await HomeyAPI.forCurrentHomey();

  //Example: Make the Homey say something to prove we're authenticated
  await homeyAPI.speechOutput.say({text: 'Hello: '+user.fullname});

  return homeyAPI;
}

login();





class Groups extends Homey.App {


  getApi() {

    console.log(HomeyAPI.forCurrentHomey());

    if (!this.api) {
      this.api = HomeyAPI.forCurrentHomey();
    }
    return this.api;
  }

  async getDevices() {
    const api = await this.getApi();
    return await api.devices.getDevices();
  }

  /**
   * Gets an API device from the APP, cache it
   *
   * Was added as storing the entire device with in a variable, in order to reduce the calls to the API
   * which appears to have a memory leak where "something" with in there is not getting GC().
   *
   * Proof of concept to store devices with in app, rather than device.
   *
   * @todo performance test against storing in the device.
   * @param id
   * @returns {Promise<*>}
   */
  async getDevice(id) {
    if (!this.devices[id]) {
      this.devices[id] = await (await this.getApi()).devices.getDevice({
        id : id
      });
    }
    return this.devices[id];
  }

  async getGroups() {
    return Homey.ManagerDrivers.getDriver('groups').getDevices();
  }

  async getGroup(id) {
    let device = await Homey.ManagerDrivers.getDriver('groups').getDevice({ id });
    if (device instanceof Error) throw device;
    return device;
  }

  async setDevicesForGroup(id, devices) {
    let group = await this.getGroup(id);

    // Find all devices that should be grouped.
    let allDevices     = await this.getDevices();

    // Looks like vue (upon settings) is sending a padded array with undefined items
    // Checks that the devices sent exist in allDevices, filters out any that do not.
    let groupedDevices = Object.values(allDevices).filter(d => devices.includes(d.id));

    let ids = [];
    for (let i in groupedDevices) {
      ids.push(groupedDevices[i].id);
    }

    group.settings.groupedDevices = ids;

    // Update the group settings.
    let result = await group.setSettings(group.settings);
    await group.refresh();

    return result;
  }

  async setMethodForCapabilityOfGroup(id, capabilities) {

    let group = await this.getGroup(id);

    group.settings.capabilities = capabilities;

    // Update the group settings.
    let result = await group.setSettings( group.settings );
    await group.refresh();
    return result;
  }

  onInit() {
    this.log('Device groups is running...');

    // Set our library reference
    this.library = new Librarian();

    // Force i18n to en or nl, as we are accessing the i18n directly,
    this.i18n = (Homey.ManagerI18n.getLanguage() === 'nl') ? 'nl' : 'en';

    // Prime the API into memory
    this.getApi();

    // Initialise the devices objects.
    // Stores all API devices used, as there seems to be a leak when calling the API for the device.
    this.devices = {};
  }
}

module.exports = Groups;



