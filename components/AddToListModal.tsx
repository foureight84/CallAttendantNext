'use client';

import { useEffect } from 'react';
import { Modal, Stack, TextInput, Button, Checkbox } from '@mantine/core';
import { useForm } from '@mantine/form';
import { apiClient } from '@/lib/api-client';

interface Props {
  opened: boolean;
  onClose: () => void;
  list: 'whitelist' | 'blacklist';
  initialValues?: { phoneNo?: string; name?: string; reason?: string };
  editMode?: boolean;
  originalPhoneNo?: string; // when set, delete old entry if phoneNo changes
  onSuccess?: () => void;
}

export function AddToListModal({ opened, onClose, list, initialValues, editMode, originalPhoneNo, onSuccess }: Props) {
  const isWhitelist = list === 'whitelist';

  const form = useForm({
    initialValues: { phoneNo: '', name: '', reason: '', wildcard: false },
    validate: {
      phoneNo: (v) => v.trim().length === 0 ? 'Phone number required' : null,
    },
  });

  useEffect(() => {
    if (opened) {
      const phoneNo = initialValues?.phoneNo ?? '';
      form.setValues({
        phoneNo,
        name: initialValues?.name ?? '',
        reason: initialValues?.reason ?? '',
        wildcard: phoneNo.includes('*'),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, initialValues?.phoneNo, initialValues?.name, initialValues?.reason]);

  const submit = form.onSubmit(async (values) => {
    const apiCall = list === 'whitelist' ? apiClient.whitelist : apiClient.blacklist;

    // If phone number changed, delete the old entry first
    if (editMode && originalPhoneNo && originalPhoneNo !== values.phoneNo) {
      await apiCall.remove({ phoneNo: originalPhoneNo });
    }
    await apiCall.add(values);
    form.reset();
    onClose();
    onSuccess?.();
  });

  const title = editMode
    ? (isWhitelist ? 'Edit Phonebook Entry' : 'Edit Blocked Number')
    : (isWhitelist ? 'Add to Phonebook' : 'Block Number');

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <form onSubmit={submit}>
        <Stack>
          <TextInput
            label="Phone Number"
            placeholder={form.values.wildcard ? '1800*' : '12125555555'}
            description={
              form.values.wildcard
                ? 'Use * to match any digits — e.g. 1800* matches all 1-800 numbers'
                : 'Must match the Caller ID format your modem receives — check the debug log for incoming calls. E.g. 12125555555 for US (country code + digits only, no dashes, spaces, or parentheses)'
            }
            required
            {...form.getInputProps('phoneNo')}
          />
          <Checkbox
            label="Wildcard entry (* matches any digits, e.g. 1800* blocks all 1-800 numbers)"
            {...form.getInputProps('wildcard', { type: 'checkbox' })}
          />
          <TextInput
            label="Name"
            placeholder={isWhitelist ? 'John Smith' : 'Telemarketer'}
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Reason"
            placeholder={isWhitelist ? 'Friend, Family, etc.' : 'Spam call, etc.'}
            {...form.getInputProps('reason')}
          />
          <Button type="submit" color={isWhitelist ? undefined : 'red'}>
            {editMode ? 'Save' : (isWhitelist ? 'Add to Phonebook' : 'Block')}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
