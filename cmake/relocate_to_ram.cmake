# Relocate selected .text.<fn> sections of one compiled object into RAM by
# renaming them to .time_critical.<fn>, which the Pico SDK linker places in RAM
# (LMA flash, VMA RAM). Run at PRE_LINK because the object's location under the
# target's .dir depends on where PICO_SDK_PATH sits: in-tree in CI
# (CMakeFiles/ds5-bridge.dir/pico-sdk/...) vs out-of-tree locally
# (.../ds5-bridge.dir/<absolute-sdk-path>/...). So we locate the object by its
# stable SDK-relative path suffix rather than hardcoding the mirrored path.
#
# Args (via -D): OBJROOT  (CMakeFiles/<target>.dir)
#                OBJCOPY  (path to arm-none-eabi-objcopy)
#                SUFFIX   (stable trailing path, e.g. lib/btstack/src/hci.c.o)
#                RENAMES  (|-separated list of old=new section pairs)
foreach(_v OBJROOT OBJCOPY SUFFIX RENAMES)
    if(NOT DEFINED ${_v})
        message(FATAL_ERROR "relocate_to_ram: missing required -D${_v}")
    endif()
endforeach()
# Locate the object: the unique file under OBJROOT whose path ends with SUFFIX.
# Match either .o (GCC default) or .obj (MinGW/Ninja on Windows) by normalising
# the trailing extension on both the candidate path and SUFFIX before comparing.
file(GLOB_RECURSE _objs "${OBJROOT}/*.o" "${OBJROOT}/*.obj")
string(REGEX REPLACE "\\.o(bj)?$" "" _sfx "${SUFFIX}")
string(LENGTH "${_sfx}" _slen)
set(_match "")
foreach(_o ${_objs})
    string(REGEX REPLACE "\\.o(bj)?$" "" _ob "${_o}")
    string(LENGTH "${_ob}" _olen)
    if(NOT _olen LESS _slen)
        math(EXPR _off "${_olen} - ${_slen}")
        string(SUBSTRING "${_ob}" ${_off} -1 _tail)
        if(_tail STREQUAL "${_sfx}")
            set(_match "${_o}")
            break()
        endif()
    endif()
endforeach()
if(NOT _match)
    message(FATAL_ERROR "relocate_to_ram: no object matching '${SUFFIX}' under '${OBJROOT}'")
endif()
# Build the objcopy argument list from the |-separated rename pairs.
string(REPLACE "|" ";" _renames "${RENAMES}")
set(_args "")
foreach(_r ${_renames})
    list(APPEND _args --rename-section "${_r}")
endforeach()
# objcopy silently no-ops a section that is absent, so this is idempotent across
# incremental relinks (already-renamed -> nothing to do).
execute_process(COMMAND "${OBJCOPY}" ${_args} "${_match}" RESULT_VARIABLE _rc)
if(NOT _rc EQUAL 0)
    message(FATAL_ERROR "relocate_to_ram: objcopy failed (rc=${_rc}) on ${_match}")
endif()