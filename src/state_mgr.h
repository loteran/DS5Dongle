//
// Created by awalol on 2026/5/15.
//

#ifndef DS5_BRIDGE_STATE_MGR_H
#define DS5_BRIDGE_STATE_MGR_H
#include <cstdint>

void state_init();
void state_set(uint8_t *data, uint8_t size);
void state_update(const uint8_t *data, uint8_t size);
void state_set_led_color(uint8_t r, uint8_t g, uint8_t b);
bool state_motors_active();
void state_clear_motors();
void set_volume(uint8_t value);
void set_volume(uint8_t speaker, uint8_t headset);
void set_trigger_reduce(uint8_t value);

#endif //DS5_BRIDGE_STATE_MGR_H
