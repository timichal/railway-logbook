export const getUntimezonedDateStr = (dateInput: string | Date): string => {
  console.log(dateInput, new Date(dateInput).getTimezoneOffset());
  return typeof dateInput === 'string'
    ? dateInput.split('T')[0]
    : new Date (dateInput.getTime() - dateInput.getTimezoneOffset() * 60000)
      .toISOString().split('T')[0];
};
